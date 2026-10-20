// Application Service судейства: пачки, кэш вердиктов и частичное сохранение.
// Заменяет judgeWithClaude из application/digest.ts: политика пачек и сохранение
// после каждой пачки — здесь, а как именно спрашивать ИИ — в JudgeStrategy.
import { chunk, runBatches } from "@/shared/batches.js";
import type { DigestPolicy } from "@/domain/digest/DigestPolicy.js";
import type { JudgementSet } from "@/domain/digest/JudgementSet.js";
import type { DigestCandidate } from "@/domain/digest/DigestCandidate.js";
import type { JudgementCache } from "@/domain/digest/ports.js";
import type { AiProvider } from "@/domain/ports.js";
import type { Resume } from "@/domain/models.js";
import { AiJudgeStrategy, type JudgeStrategy } from "@/application/digest/JudgeStrategy.js";
import log from "@/shared/logger.js";

/** Итог прогона судьи: сколько вакансий реально ушло в модель. */
export interface JudgeRunResult {
  judgedCount: number;
}

/** Где сохранять вердикты: дата кэша поиска и id резюме (ключ коллекции). */
export interface JudgeContext {
  resumeId?: string;
  date?: Date;
}

export class DigestJudgeRunner {
  constructor(
    private readonly cache: JudgementCache,
    private readonly strategy: JudgeStrategy = new AiJudgeStrategy(),
  ) {}

  /**
   * Судит только тех, для кого нет вердикта; уже известные берёт из набора.
   * Пачка сохраняется сразу после ответа — прерывание не теряет прогресс.
   */
  async judge(
    ai: AiProvider | null,
    resume: Resume,
    candidates: DigestCandidate[],
    judgements: JudgementSet,
    policy: DigestPolicy,
    ctx: JudgeContext = {},
  ): Promise<JudgeRunResult> {
    const pending = judgements.pending(candidates);
    if (pending.length < candidates.length) {
      log.info(`Judgements from cache: ${candidates.length - pending.length}/${candidates.length}`);
    }

    const batches = chunk(pending, policy.judgeBatchSize).map(group => group.map(c => c.full));
    const opts = { minScore: policy.minScore, adaptResume: policy.adaptResume, logger: log };
    let judgedCount = 0;

    const runBatch = async (idx: number, batch: any[]) => {
      log.info(`Judging batch ${idx}: ${batch.length} vacancies`);
      const result = await this.strategy.judgeBatch(ai, resume, batch, opts);
      if (!result) {
        log.warn(`Batch ${idx} failed, falling back to per-item judge`);
        for (const vacancy of batch) {
          const judgement = await this.strategy.judgeOne(ai, resume, vacancy, opts);
          if (judgement) {
            judgements.merge(new Map([[String(vacancy.id), judgement]]));
            await this.cache.save(judgements.toSnapshot(), ctx.resumeId, ctx.date);
          }
          judgedCount++;
        }
      } else {
        judgements.merge(result);
        await this.cache.save(judgements.toSnapshot(), ctx.resumeId, ctx.date);
        judgedCount += batch.length;
      }
    };

    // Ошибка пачки валит прогон (как раньше): пул не должен её глотать.
    await runBatches(batches, policy.aiConcurrency, (batch, index) => runBatch(index + 1, batch), {
      onError: (err) => { throw err; },
      logger: log,
    });
    return { judgedCount };
  }
}
