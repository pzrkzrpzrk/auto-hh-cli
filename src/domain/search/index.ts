// Публичная поверхность доменного модуля поиска: VO и порт источника.
export { SearchQuery } from "@/domain/search/SearchQuery.js";
export { SearchBucket } from "@/domain/search/SearchBucket.js";
export { PageKey } from "@/domain/search/PageKey.js";
export { AllVacanciesPolicy, SkipSeenPolicy } from "@/domain/search/FullCardPolicy.js";
export type { FullCardPolicy } from "@/domain/search/FullCardPolicy.js";
export type { VacancySource } from "@/domain/search/VacancySource.js";
export type {
  Vacancy,
  VacancyListItem,
  SearchParams,
  SearchPageResult,
  SearchConfig,
} from "@/domain/search/types.js";
