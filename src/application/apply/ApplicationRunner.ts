// Исполнитель плана отклика: проверка входа, пропуски по цепочке правил, счётчики.
// Браузер открывает и закрывает адаптер (RAII), поэтому здесь — только работа внутри сессии.
import log from "@/shared/logger.js";
import type { DigestEntry } from "@/domain/models.js";
import type { ApplicationSession } from "@/domain/ports.js";
import type { ApplyDeps, ApplyOutcome } from "@/application/apply/ApplyDeps.js";
import type { ApplySummary } from "@/application/apply/ApplySummary.js";
import type { Pacing } from "@/application/apply/Pacing.js";
import type { SkipDecision, SkipRule } from "@/application/apply/SkipRules.js";

export class ApplicationRunner {
  constructor(
    private readonly deps: ApplyDeps,
    private readonly skipRules: SkipRule,
    private readonly pacing: Pacing,
    private readonly summary: ApplySummary,
  ) {}

  /** План отклика внутри уже открытой сессии: вход → цикл → сводка. */
  async run(
    session: ApplicationSession,
    planned: DigestEntry[],
    applied: Record<string, any>,
  ): Promise<ApplyOutcome> {
    if (!await session.ensureLoggedIn()) {
      // process.exit() здесь оборвал бы finally в withSession и незаписанные данные в Mongo.
      return { kind: 'not-logged-in' };
    }

    for (const entry of planned) {
      const skip = this.skipRules.check(entry, applied);
      if (skip) {
        this.reportSkip(skip);
        continue;
      }
      await this.tryApply(session, entry);
      // Пауза только после реальной попытки: пропуски не должны растягивать прогон.
      await this.pacing.pause();
    }

    log.info(`Done. ${this.summary.toString()}`);
    return this.summary.toOutcome();
  }

  /** Пропуск — решение правила: уровень лога и вклад в сводку задаёт само правило. */
  private reportSkip(decision: SkipDecision): void {
    if (decision.level === 'warn') log.warn(decision.message);
    else log.info(decision.message);
    if (decision.counted) this.summary.markSkipped();
  }

  /** Один отклик: ошибка сессии и отметки в истории одинаково считаются неудачей. */
  private async tryApply(session: ApplicationSession, entry: DigestEntry): Promise<void> {
    try {
      const result = await session.apply(entry);
      if (!result.ok) {
        this.summary.markFailed();
        return;
      }
      await this.deps.history.markApplied(entry.id, { via: 'playwright', url: entry.url });
      this.summary.markApplied();
    } catch (err: any) {
      log.warn(`Apply failed for ${entry.id}: ${err.message}`);
      this.summary.markFailed();
    }
  }
}
