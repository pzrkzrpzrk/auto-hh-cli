// Сценарий поиска: точка входа для команды и обратная совместимость runSearch().
// Вся оркестрация — SearchScenario (фасад) + стадии конвейера.
import type { SearchDeps } from "@/domain/ports.js";
import { SearchScenario } from "@/application/search/SearchScenario.js";
import type { SearchEvent } from "@/application/search/SearchEvent.js";
import type { SearchOptions } from "@/application/options.js";

export type { SearchEvent };
export type { FullCardsSummary } from "@/application/search/VacancyCollector.js";

/**
 * Поиск вакансий и догрузка описаний.
 * opts: { config?: string; resume?: string; reset?: boolean } — те же флаги, что были у команды.
 */
export async function runSearch(
  opts: SearchOptions = {},
  deps: SearchDeps,
  report?: (event: SearchEvent) => void,
): Promise<void> {
  return new SearchScenario(deps, report).run(opts);
}
