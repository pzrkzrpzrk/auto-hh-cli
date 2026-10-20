// Типы поиска вакансий: то, что сценарии получают от источника (hh.ru) и отдают в кэш.
// Живут в домене, чтобы application не зависел от Playwright-адаптера.
import type { Vacancy } from "@/domain/models.js";

/** Элемент выдачи поиска — краткая карточка (id, name, employer, area, salary, url). */
export interface VacancyListItem {
  id: string;
  name: string;
  employer?: { name?: string | null; id?: number | string } | null;
  area?: { id?: number | string | null; name?: string | null } | null;
  salary?: { from?: number | null; to?: number | null; currency?: string | null } | null;
  alternate_url?: string;
  snippet?: unknown;
  archived?: boolean;
  key_skills?: { name: string }[];
  [key: string]: unknown;
}

/** Параметры запроса выдачи (query string hh.ru). */
export interface SearchParams {
  text?: string;
  area?: (string | number)[] | string | number;
  experience?: string;
  salary?: number | string;
  only_with_salary?: boolean;
  currency?: string;
  per_page?: number;
  page?: number;
  schedule?: string;
  employment?: string;
  search_period?: number | string;
  order_by?: string;
}

/** Одна страница выдачи: элементы, всего найдено, всего страниц. */
export interface SearchPageResult {
  items: VacancyListItem[];
  found: number;
  pages: number;
}

/** Снимок кэша поиска: страницы выдачи и полные карточки (cachePages/cacheFull). */
export interface SearchCacheSnapshot {
  date: string;
  pages: Record<string, VacancyListItem[]>;
  fullById: Record<string, Vacancy>;
}

/** Секция config.search, с которой работает сценарий поиска. */
export interface SearchConfig {
  text?: string;
  area?: (string | number)[] | string | number;
  remote_area?: (string | number)[] | string | number | null;
  schedule?: string;
  experience?: string;
  salary?: number | string;
  only_with_salary?: boolean;
  currency?: string;
  per_page?: number;
  start_page?: number;
  max_pages?: number;
  search_period?: number | string;
  order_by?: string;
  employment?: string;
  [key: string]: unknown;
}

export type { Vacancy };
