// Конвейер дайджеста (Chain of Responsibility): стадии идут по порядку,
// каждая может остановить цепочку (пустой кэш, пустая выдача, dry-run).
import type { DigestContext } from "@/application/digest/DigestContext.js";
import type { DigestStage } from "@/application/digest/DigestStage.js";

export class DigestPipeline {
  constructor(private readonly stages: DigestStage[]) {}

  async run(ctx: DigestContext): Promise<void> {
    for (const stage of this.stages) {
      if (await stage.run(ctx) === 'stop') break;
    }
  }
}
