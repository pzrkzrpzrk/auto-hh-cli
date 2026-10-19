// Итератор страниц прохода: отдаёт страницу из кэша или из источника и сам решает,
// когда остановиться (последняя страница выдачи). Страница 0 всегда запрашивается заново.
import { PageKey } from "../../domain/search/PageKey.js";
import { SearchBucket } from "../../domain/search/SearchBucket.js";
import { SearchQuery } from "../../domain/search/SearchQuery.js";
import type { VacancySource } from "../../domain/search/VacancySource.js";
import type { VacancyListItem } from "../../domain/search/types.js";
import SearchCache from "./SearchCache.js";
import { SearchRequestBuilder } from "./SearchRequestBuilder.js";

export interface PageView {
  key: PageKey;
  items: VacancyListItem[];
  /** true — страница взята из кэша, в источник не ходили. */
  fromCache: boolean;
  /** Всего найдено (только для страниц из источника). */
  found?: number;
  /** Всего страниц по мнению hh.ru (только для страниц из источника). */
  pages?: number;
}

export class PageIterator {
  constructor(
    private readonly source: VacancySource,
    private readonly cache: SearchCache,
    private readonly query: SearchQuery,
  ) {}

  async *pages(bucket: SearchBucket): AsyncGenerator<PageView> {
    for (const page of this.query.pages()) {
      const key = new PageKey(bucket, page);

      // Страница 0 каждого прохода запрашивается заново — на ней новые вакансии.
      const cached = key.isAlwaysFresh ? null : this.cache.page(key.key);
      if (cached) {
        yield { key, items: cached, fromCache: true };
        continue;
      }

      const result = await this.source.searchVacancies(
        new SearchRequestBuilder(this.query).forBucket(bucket).page(page).build(),
      );
      yield { key, items: result.items, fromCache: false, found: result.found, pages: result.pages };

      if (page + 1 >= (result.pages || 0)) return;
    }
  }
}
