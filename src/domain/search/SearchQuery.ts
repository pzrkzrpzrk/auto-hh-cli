// Запрос поиска как значение: инкапсулирует config.search и правила проходов/страниц.
// Раньше это была функция searchBuckets(search) с мешком any в аргументах.
import { SearchBucket } from "@/domain/search/SearchBucket.js";
import type { SearchConfig } from "@/domain/search/types.js";

export class SearchQuery {
  constructor(private readonly search: SearchConfig = {}) {}

  get config(): SearchConfig {
    return this.search;
  }

  get text(): string | undefined {
    return this.search.text;
  }

  get perPage(): number {
    return this.search.per_page || 50;
  }

  get startPage(): number {
    return this.search.start_page || 0;
  }

  get maxPages(): number {
    return this.search.max_pages || 1;
  }

  /** Проходы поиска: основной + «только удалёнка», если задан remote_area. */
  buckets(): SearchBucket[] {
    const buckets = [new SearchBucket('', '', this.search.area, this.search.schedule)];

    const rawRemoteArea = this.search.remote_area;
    const remoteArea = (Array.isArray(rawRemoteArea) ? rawRemoteArea : rawRemoteArea != null ? [rawRemoteArea] : [])
      .filter(id => id != null);
    if (remoteArea.length) {
      buckets.push(new SearchBucket('remote:', ' (только удалёнка)', remoteArea, 'remote'));
    }
    return buckets;
  }

  /** Номера страниц: start_page .. start_page + max_pages - 1. */
  pages(): number[] {
    const pages: number[] = [];
    for (let page = this.startPage; page < this.startPage + this.maxPages; page++) pages.push(page);
    return pages;
  }
}
