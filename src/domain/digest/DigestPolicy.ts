// Политика прогона дайджеста (Value Object + Strategy).
// Раньше minScore/maxRun/dryRun/useClaude вычислялись россыпью переменных внутри
// buildDigest; теперь это один неизменяемый объект, который читают стадии конвейера.
import type { DigestConfig, DigestRunOptions } from "@/domain/digest/types.js";
import { adaptBudget } from "@/domain/adapt-resume/index.js";

/** Внешние факты, от которых зависит политика (их определяет сценарий). */
export interface DigestPolicyContext {
  /** Резюме загружено: без него ИИ-судья не включается. */
  hasResume: boolean;
  /** Ключ ИИ задан в config.json или окружении. */
  hasApiKey: boolean;
  /** Размер пачки судьи (env JUDGE_BATCH_SIZE). */
  judgeBatchSize: number;
  /** Параллелизм ИИ-запросов (env AI_CONCURRENCY). */
  aiConcurrency: number;
}

export class DigestPolicy {
  private constructor(
    /** Минимальная оценка, которую судья считает проходной. */
    readonly minScore: number,
    /** Сколько вакансий максимум попадает в дайджест. */
    readonly maxRun: number,
    /** Прогон без записи истории, дайджеста и rejected. */
    readonly dryRun: boolean,
    /** Включён ли ИИ-судья (нужны резюме, ключ и `--no-claude` не выставлен). */
    readonly useJudge: boolean,
    /** Адаптировать резюме под каждую вакансию перед судейством. */
    readonly adaptResume: boolean,
    /** Лимит символов на адаптированное резюме. */
    readonly adaptResumeBudget: number,
    /** Пачка вакансий на один запрос судьи. */
    readonly judgeBatchSize: number,
    /** Сколько пачек судьи выполняется одновременно. */
    readonly aiConcurrency: number,
  ) {}

  /** Собрать политику из config.json, флагов команды и фактов окружения. */
  static from(
    cfg: DigestConfig,
    opts: DigestRunOptions,
    ctx: DigestPolicyContext,
  ): DigestPolicy {
    const apply = cfg.apply || {};
    return new DigestPolicy(
      apply.minClaudeScore ?? 7,
      // Как и раньше: 0/пустое значение означает «взять из конфига», затем 50.
      opts.limit || apply.maxPerRun || 50,
      opts.dryRun ?? apply.dryRun ?? false,
      Boolean(ctx.hasResume && ctx.hasApiKey && opts.claude !== false),
      cfg.adaptResume !== false,
      adaptBudget(cfg.adaptResumeBudget),
      Math.max(1, Math.floor(ctx.judgeBatchSize) || 1),
      Math.max(1, Math.floor(ctx.aiConcurrency) || 1),
    );
  }

  /** Писать ли историю: dry-run не должен оставлять следов. */
  get tracksHistory(): boolean {
    return !this.dryRun;
  }
}
