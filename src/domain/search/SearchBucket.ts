// Проход поиска: регион(ы) + принудительный график.
// Ключи страниц в кэше разведены префиксом, иначе проходы перезаписывали бы страницы друг друга.
//   config.search.area        — регионы, где берём ЛЮБЫЕ вакансии;
//   config.search.remote_area — регионы, где берём ТОЛЬКО удалёнку (schedule=remote).
import type { SearchParams } from "@/domain/search/types.js";

export class SearchBucket {
  constructor(
    /** Префикс ключа страницы в кэше: '' или 'remote:'. */
    readonly prefix: string,
    /** Подпись прохода в логах: '' или ' (только удалёнка)'. */
    readonly label: string,
    readonly area: SearchParams["area"],
    /** Принудительный график прохода (для «удалённого» — remote). */
    readonly schedule?: string,
  ) {}
}
