// Порт источника вакансий (DIP): сценарии просят «поиск» и «карточку»,
// а Playwright-адаптер hh.ru подставляет composition root.
import type { Vacancy } from "../models.js";
import type { SearchParams, SearchPageResult } from "./types.js";

export interface VacancySource {
  /** Одна страница выдачи по параметрам запроса. */
  searchVacancies(params: SearchParams): Promise<SearchPageResult>;
  /** Полная карточка вакансии; null — страница не разобралась. */
  getVacancy(id: string | number): Promise<Vacancy | null>;
}
