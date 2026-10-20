// Фасад сценария поиска: сброс → открытие источника → конвейер стадий.
// Стадии ничего не знают друг о друге, порядок и «стоп» задаёт конвейер.
import { formatResetSummary } from "@/application/reset.js";
import type { SearchDeps } from "@/domain/ports.js";
import { SearchQuery } from "@/domain/search/SearchQuery.js";
import SearchCache from "@/application/search/SearchCache.js";
import { VacancyCollector } from "@/application/search/VacancyCollector.js";
import { SearchPipeline } from "@/application/search/SearchPipeline.js";
import { CollectFullCardsStage, CollectPagesStage, ExportSearchFileStage } from "@/application/search/stages.js";
import type { SearchContext } from "@/application/search/SearchContext.js";
import type { SearchEvent } from "@/application/search/SearchEvent.js";
import log from "@/shared/logger.js";

export class SearchScenario {
  private readonly pipeline: SearchPipeline;

  constructor(
    private readonly deps: SearchDeps,
    private readonly report: (event: SearchEvent) => void = () => {},
  ) {
    this.pipeline = new SearchPipeline([
      new CollectPagesStage(),
      new ExportSearchFileStage(),
      new CollectFullCardsStage(),
    ]);
  }

  async run(opts: Record<string, any> = {}): Promise<void> {
    // Сброс — до открытия источника, как и раньше (resetData вызывался до new HHClient).
    let didReset = false;
    if (opts.reset) {
      const summary = await this.deps.janitor.clearAll();
      this.report({ type: 'reset', text: formatResetSummary(summary) });
      didReset = true;
    }

    try {
      await this.deps.source.withSource(async source => {
        const cfg = this.deps.config.load(opts.config);
        log.info('Searching vacancies', cfg.search);

        const cache = await SearchCache.load(this.deps.cacheStore);
        const ctx: SearchContext = {
          opts,
          cfg,
          query: new SearchQuery(cfg.search),
          cache,
          collector: new VacancyCollector(source, cache, this.deps.history),
          report: this.report,
          writer: this.deps.reportWriter,
          items: [],
          stopped: false,
        };

        await this.pipeline.run(ctx);
        if (!ctx.stopped) this.report({ type: 'done' });
      });
    } catch (err: any) {
      // Если сброс уже прошёл, молчать нельзя: иначе это выглядит как «ничего не произошло».
      if (didReset) this.report({ type: 'search-failed-after-reset' });
      throw err;
    }
  }
}
