// Публичная поверхность доменного модуля поиска: VO и порт источника.
export { SearchQuery } from "./SearchQuery.js";
export { SearchBucket } from "./SearchBucket.js";
export { PageKey } from "./PageKey.js";
export { AllVacanciesPolicy, SkipSeenPolicy } from "./FullCardPolicy.js";
export type { FullCardPolicy } from "./FullCardPolicy.js";
export type { VacancySource } from "./VacancySource.js";
export type {
  Vacancy,
  VacancyListItem,
  SearchParams,
  SearchPageResult,
  SearchConfig,
} from "./types.js";
