// Конвейер подготовки плана отклика (Chain of Responsibility/Composite): стадии
// идут по порядку, пока одна из них не попросит «стоп».
import type { ApplyContext } from "./ApplyContext.js";
import type { ApplyStage } from "./ApplyStage.js";

export class ApplyPipeline {
  constructor(private readonly stages: ApplyStage[]) {}

  async run(ctx: ApplyContext): Promise<void> {
    for (const stage of this.stages) {
      if (await stage.run(ctx) === 'stop') return;
    }
  }
}
