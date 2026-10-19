// Порты хранилищ для доменного слоя (DIP).
// Домен зависит от этих узких интерфейсов, а не от конкретных модулей store/ (MongoDB).
// Реализации подставляет вызывающий код (CLI — временный composition root), поэтому
// доменные шаги можно прогонять с подставными хранилищами, без базы.

/**
 * История откликов и просмотров — домену нужны только эти две операции:
 * узнать, что уже просмотрено (шаг сбора карточек), и пометить просмотренным.
 */
export interface HistoryStore {
  load(): Promise<{ applied: Record<string, any>; seen: Record<string, string> }>;
  markSeen(vacancyId: string | number): Promise<void>;
}

/** Кэш поиска: запись страниц выдачи (cachePages) и полных карточек (cacheFull). */
export interface CacheStore {
  savePage(state: any, pageNum: number | string, date?: Date): Promise<void>;
  saveFullVacancy(vacancy: any, date?: Date): Promise<void>;
}

/** Зависимости шагов сбора вакансий. */
export interface CollectDeps {
  cacheStore: CacheStore;
  history: HistoryStore;
}
