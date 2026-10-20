// Команда search: подключить консольный репортер к сценарию поиска.
// Отбор + ИИ-судья — отдельный шаг `digest`, сопроводительные — отдельный шаг `cover`.
import { searchDeps } from "@/composition.js";
import { runSearch } from "@/application/search.js";
import { ConsoleSearchReporter } from "@/presentation/cli/format/search-report.js";

export default async function search(opts: Record<string, any> = {}) {
  const reporter = new ConsoleSearchReporter();
  await runSearch(opts, searchDeps, event => reporter.on(event));
}
