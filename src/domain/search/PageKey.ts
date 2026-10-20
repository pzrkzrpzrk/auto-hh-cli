// Ключ страницы в кэше: префикс прохода + номер. Страница 0 всегда запрашивается заново
// (на ней новые вакансии), остальные берутся из кэша.
import type { SearchBucket } from "@/domain/search/SearchBucket.js";

export class PageKey {
  constructor(
    readonly bucket: SearchBucket,
    readonly page: number,
  ) {}

  /** Ключ в cache.pages: '3' или 'remote:3'. */
  get key(): string {
    return `${this.bucket.prefix}${this.page}`;
  }

  get isAlwaysFresh(): boolean {
    return this.page === 0;
  }
}
