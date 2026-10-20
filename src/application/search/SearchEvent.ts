// События фаз поиска: команда печатает их в том же порядке, в каком они происходили раньше.
import type { SearchFileResult } from "@/domain/models.js";
import type { VacancyListItem } from "@/domain/search/types.js";
import type { FullCardsSummary } from "@/application/search/VacancyCollector.js";

export type SearchEvent =
  | { type: 'reset'; text: string }
  | { type: 'found'; items: VacancyListItem[] }
  | { type: 'nothing-found' }
  | { type: 'files-saved'; results: SearchFileResult[]; added: number; total: number }
  | { type: 'files-unchanged'; results: SearchFileResult[]; total: number }
  | { type: 'files-failed'; message: string }
  | { type: 'full-start'; total: number; cached: number; skippedSeen: number }
  | { type: 'full-progress'; done: number; total: number; name: string }
  | { type: 'full-cards'; summary: FullCardsSummary }
  | { type: 'full-cards-failed'; message: string }
  | { type: 'done' }
  | { type: 'search-failed-after-reset' };

/** Наблюдатель фаз поиска (Observer): команда подставляет консольный репортер. */
export interface SearchReporter {
  on(event: SearchEvent): void;
}
