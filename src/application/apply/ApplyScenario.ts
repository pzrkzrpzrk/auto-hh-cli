// Сценарий отклика (Facade): ручной вход → стратегия выбора вакансий → конвейер
// подготовки плана → сессия браузера (RAII) → исполнитель цикла.
// Импортов infrastructure здесь нет: Playwright и MongoDB приходят портами из composition root.
import type { ApplyDeps, ApplyOutcome } from "./ApplyDeps.js";
import { ApplyPipeline } from "./ApplyPipeline.js";
import { ApplySummary } from "./ApplySummary.js";
import { ApplicationRunner } from "./ApplicationRunner.js";
import { digestSelection } from "./DigestSelection.js";
import { RandomPacing } from "./Pacing.js";
import { applySkipRules } from "./SkipRules.js";
import {
  AttachLettersStage,
  FilterArchivedStage,
  LimitStage,
  LoadDigestStage,
  LoadHistoryStage,
} from "./stages.js";
import type { ApplyContext } from "./ApplyContext.js";

export class ApplyScenario {
  private readonly pipeline = new ApplyPipeline([
    new LoadDigestStage(),
    new FilterArchivedStage(),
    new LimitStage(),
    new AttachLettersStage(),
    new LoadHistoryStage(),
  ]);

  constructor(private readonly deps: ApplyDeps) {}

  /** opts: { login?: boolean; type?: 'latest' | 'all'; limit?: number } — флаги команды. */
  async run(opts: Record<string, any> = {}): Promise<ApplyOutcome> {
    if (opts.login) {
      await this.deps.login.login();
      return { kind: 'login' };
    }

    const ctx = this.createContext(opts);
    await this.pipeline.run(ctx);

    // Браузер открывает и закрывает адаптер: сценарию остаётся цикл откликов.
    return this.deps.gateway.withSession(session =>
      new ApplicationRunner(ctx.deps, ctx.skipRules, ctx.pacing, ctx.summary)
        .run(session, ctx.planned, ctx.applied),
    );
  }

  private createContext(opts: Record<string, any>): ApplyContext {
    return {
      deps: this.deps,
      opts,
      selection: digestSelection(opts.type || 'latest'),
      skipRules: applySkipRules(),
      pacing: new RandomPacing(this.deps.settings),
      summary: new ApplySummary(),
      entries: [],
      planned: [],
      applied: {},
    };
  }
}
