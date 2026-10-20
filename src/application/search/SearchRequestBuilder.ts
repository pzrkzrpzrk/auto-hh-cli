// Сборка параметров запроса выдачи (Builder): config.search + проход + страница.
import { SearchQuery } from "@/domain/search/SearchQuery.js";
import { SearchBucket } from "@/domain/search/SearchBucket.js";
import type { SearchParams } from "@/domain/search/types.js";

export class SearchRequestBuilder {
  private readonly params: SearchParams;

  constructor(query: SearchQuery) {
    const search = query.config;
    this.params = {
      text: search.text,
      experience: search.experience,
      salary: search.salary,
      only_with_salary: search.only_with_salary,
      currency: search.currency,
      per_page: search.per_page || 50,
      // Фильтр по дате публикации и порядок выдачи — из config.search.
      search_period: search.search_period,
      order_by: search.order_by,
    };
    if (search.employment) this.params.employment = search.employment;
  }

  forBucket(bucket: SearchBucket): this {
    this.params.area = bucket.area;
    if (bucket.schedule) this.params.schedule = bucket.schedule;
    return this;
  }

  page(page: number): this {
    this.params.page = page;
    return this;
  }

  build(): SearchParams {
    return { ...this.params };
  }
}
