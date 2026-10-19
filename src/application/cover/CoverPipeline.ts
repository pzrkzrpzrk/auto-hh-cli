// Конвейер подготовки писем (Chain of Responsibility/Composite): стадии идут по порядку,
// пока одна из них не попросит «стоп» (пустой дайджест, нет описаний, все письма готовы).
import type { CoverContext } from "./CoverContext.js";
import type { CoverStage } from "./CoverStage.js";

export class CoverPipeline {
  constructor(private readonly stages: CoverStage[]) {}

  async run(ctx: CoverContext): Promise<void> {
    for (const stage of this.stages) {
      if (await stage.run(ctx) === 'stop') return;
    }
  }
}
