// Режим «весь последний дайджест»: конвейер стадий подготавливает план, догружает описания,
// генерирует письма пачками и обновляет дайджест. Печать остаётся в команде.
import type { AiProvider } from "@/domain/ports.js";
import type { Resume } from "@/domain/models.js";
import type { CoverConfig, CoverDeps, CoverOutcome } from "@/application/cover/CoverDeps.js";
import type { CoverMode } from "@/application/cover/CoverMode.js";
import { CoverPipeline } from "@/application/cover/CoverPipeline.js";
import {
  AttachLettersStage,
  EnsureCardsStage,
  GenerateLettersStage,
  LimitStage,
  LoadDigestStage,
  PersistDigestStage,
  SelectItemsStage,
} from "@/application/cover/stages.js";
import type { CoverContext } from "@/application/cover/CoverContext.js";
import type { CoverOptions } from "@/application/options.js";

export class DigestCoverMode implements CoverMode {
  private readonly pipeline = new CoverPipeline([
    new LoadDigestStage(),
    new LimitStage(),
    new AttachLettersStage(),
    new EnsureCardsStage(),
    new SelectItemsStage(),
    new GenerateLettersStage(),
    new PersistDigestStage(),
  ]);

  constructor(
    private readonly deps: CoverDeps,
    private readonly cfg: CoverConfig,
    private readonly ai: AiProvider | null,
    private readonly resume: Resume,
    private readonly opts: CoverOptions,
  ) {}

  async run(): Promise<CoverOutcome> {
    const ctx = this.createContext();
    await this.pipeline.run(ctx);
    if (ctx.outcome !== 'ok') return { kind: 'empty' };
    return { kind: 'digest', entries: ctx.entries, letters: ctx.letters };
  }

  private createContext(): CoverContext {
    return {
      deps: this.deps,
      opts: this.opts,
      cfg: this.cfg,
      ai: this.ai,
      resume: this.resume,
      digest: null,
      entries: [],
      pending: [],
      fullById: {},
      items: [],
      letters: new Map<string, string>(),
      outcome: 'ok',
    };
  }
}
