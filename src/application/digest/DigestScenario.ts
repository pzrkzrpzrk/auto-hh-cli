// Сценарий сборки дайджеста (Facade): один вход для команды, внутри — конвейер стадий.
// Команда больше не собирает политику, коллектор и сервисы руками.
import { aiConcurrencyFromEnv } from "../../shared/concurrency.js";
import { loadConfig } from "../../infrastructure/config/config.js";
import { intFromEnv } from "../../infrastructure/config/env.js";
import { DigestPolicy } from "../../domain/digest/DigestPolicy.js";
import { DigestFilter } from "../../domain/digest/DigestFilter.js";
import { JudgementSet } from "../../domain/digest/JudgementSet.js";
import type { DigestEntry, Resume } from "../../domain/models.js";
import type { RejectedEntry } from "../../domain/digest/DigestCandidate.js";
import type {
  DigestCacheSnapshot,
  DigestConfig,
  DigestRunOptions,
} from "../../domain/digest/types.js";
import type { VacancySource } from "../../domain/search/VacancySource.js";
import type { DigestContext } from "./DigestContext.js";
import type { DigestDeps } from "./DigestDeps.js";
import type { DigestReporter } from "./DigestEvent.js";
import { DigestPipeline } from "./DigestPipeline.js";
import {
  CollectCardsStage,
  JudgeStage,
  LoadCacheStage,
  LocalFilterStage,
  PersistStage,
  RegisterResumeStage,
  SelectStage,
} from "./stages.js";

/** Результат сборки: что попало в дайджест и было ли это dry-run. */
export interface DigestBuildResult {
  matched: DigestEntry[];
  rejected: RejectedEntry[];
  dryRun: boolean;
}

interface ScenarioParams {
  source: VacancySource;
  cfg: DigestConfig;
  policy: DigestPolicy;
  filter: DigestFilter;
  resume: Resume | null;
  opts: DigestRunOptions;
}

export class DigestScenario {
  private readonly pipeline = new DigestPipeline([
    new LoadCacheStage(),
    new RegisterResumeStage(),
    new CollectCardsStage(),
    new LocalFilterStage(),
    new JudgeStage(),
    new SelectStage(),
    new PersistStage(),
  ]);

  constructor(
    private readonly deps: DigestDeps,
    private readonly report: DigestReporter = { on: () => {} },
  ) {}

  /**
   * Кэш поиска → фильтр → судья → digest/rejected.
   * null — собирать нечего (пустой кэш или пустая выдача).
   */
  async build(opts: DigestRunOptions = {}): Promise<DigestBuildResult | null> {
    if (opts.config) process.env.CONFIG_PATH = opts.config;

    const cfg = loadConfig();
    const resume = this.deps.resumeFiles.load(opts.resume);
    const hasApiKey = Boolean(cfg.api?.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    // Все флаги прогона — в одном объекте (domain/digest/DigestPolicy.ts).
    const policy = DigestPolicy.from(cfg, opts, {
      hasResume: Boolean(resume),
      hasApiKey,
      judgeBatchSize: intFromEnv('JUDGE_BATCH_SIZE', 10),
      aiConcurrency: aiConcurrencyFromEnv(),
    });
    // Правила локального пре-фильтра собираются один раз (domain/digest/DigestFilter.ts).
    const filter = DigestFilter.from(cfg);

    return this.deps.source.withSource(async source => {
      const ctx = this.createContext({ source, cfg, policy, filter, resume, opts });
      await this.pipeline.run(ctx);
      if (ctx.outcome !== 'ok') return null;
      return { matched: ctx.matched, rejected: ctx.rejected, dryRun: policy.dryRun };
    });
  }

  private createContext(params: ScenarioParams): DigestContext {
    return {
      deps: this.deps,
      opts: params.opts,
      cfg: params.cfg,
      policy: params.policy,
      filter: params.filter,
      resume: params.resume,
      resumeId: params.resume?.id,
      source: params.source,
      report: this.report,
      cache: null,
      snapshot: null as DigestCacheSnapshot | null,
      judgements: JudgementSet.fromSnapshot({}),
      items: [],
      candidates: [],
      accepted: [],
      rejected: [],
      matched: [],
      judgedCount: 0,
      outcome: 'ok',
    };
  }
}
