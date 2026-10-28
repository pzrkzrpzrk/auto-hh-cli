// Сценарий отклика (Facade): ручной вход → стратегия выбора вакансий → конвейер
// подготовки плана → сессия браузера (RAII) → исполнитель цикла.
// Импортов infrastructure здесь нет: Playwright и SQLite приходят портами из composition root.
import type { ApplyDeps, ApplyOutcome } from "@/application/apply/ApplyDeps.js";
import { ApplyPipeline } from "@/application/apply/ApplyPipeline.js";
import { ApplySummary } from "@/application/apply/ApplySummary.js";
import { ApplicationRunner } from "@/application/apply/ApplicationRunner.js";
import { digestSelection } from "@/application/apply/DigestSelection.js";
import { RandomPacing } from "@/application/apply/Pacing.js";
import { applySkipRules } from "@/application/apply/SkipRules.js";
import {
  AttachLettersStage,
  FilterArchivedStage,
  LimitStage,
  LoadDigestStage,
  LoadHistoryStage,
} from "@/application/apply/stages.js";
import type { ApplyContext } from "@/application/apply/ApplyContext.js";
import type { ApplyOptions } from "@/application/options.js";

export class ApplyScenario {
  private readonly pipeline = new ApplyPipeline([
    new LoadDigestStage(),
    new FilterArchivedStage(),
    new LimitStage(),
    new AttachLettersStage(),
    new LoadHistoryStage(),
  ]);

  constructor(private readonly deps: ApplyDeps) {}

  /** opts: { login?: boolean; type?: 'latest' | 'all'; limit?: number; resume?: string } — флаги команды. */
  async run(opts: ApplyOptions = {}): Promise<ApplyOutcome> {
    if (opts.login) {
      await this.deps.login.login();
      return { kind: 'login' };
    }

    // Явно выбранное резюме ограничивает и дайджест, и письма; без него — все резюме.
    let resumeId: string | null = null;
    if (opts.resume) {
      try {
        const resume = this.deps.resumeFiles.load(opts.resume);
        if (!resume) return { kind: 'no-resume', name: String(opts.resume) };
        resumeId = resume.id;
      } catch {
        return { kind: 'no-resume', name: String(opts.resume) };
      }
    }

    const ctx = this.createContext(opts, resumeId);
    await this.pipeline.run(ctx);

    // Браузер открывает и закрывает адаптер: сценарию остаётся цикл откликов.
    return this.deps.gateway.withSession(session =>
      new ApplicationRunner(ctx.deps, ctx.skipRules, ctx.pacing, ctx.summary)
        .run(session, ctx.planned, ctx.applied),
    );
  }

  private createContext(opts: ApplyOptions, resumeId: string | null): ApplyContext {
    return {
      deps: this.deps,
      opts,
      selection: digestSelection(opts.type || 'latest'),
      resumeId,
      skipRules: applySkipRules(),
      pacing: new RandomPacing(this.deps.settings),
      summary: new ApplySummary(),
      entries: [],
      planned: [],
      applied: {},
    };
  }
}
