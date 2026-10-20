// Конвейер стадий поиска (Composite/Chain): идут по порядку, пока стадия не попросит «стоп».
import type { SearchContext } from "@/application/search/SearchContext.js";
import type { SearchStage } from "@/application/search/SearchStage.js";

export class SearchPipeline {
  constructor(private readonly stages: SearchStage[]) {}

  async run(ctx: SearchContext): Promise<void> {
    for (const stage of this.stages) {
      const result = await stage.run(ctx);
      if (result === 'stop') return;
    }
  }
}
