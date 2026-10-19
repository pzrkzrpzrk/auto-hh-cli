// Сценарий поиска: страницы выдачи hh.ru → cachePages, затем полные карточки → cacheFull.
// Вывод остаётся в команде: сценарий сообщает о фазах событиями SearchEvent,
// поэтому порядок сообщений относительно логов не меняется.
import HHClient from "../infrastructure/hh/client.js";
import { loadConfig } from "../infrastructure/config/config.js";
import * as collectCache from "../infrastructure/mongo/cache-store.js";
import { collectVacancies, collectFullVacancies, flattenCollected, fmtSalary } from "./collect.js";
import resetData, { formatResetSummary } from "./reset.js";
import { writeSearchResults } from "../infrastructure/files/search-output.js";
import type { CollectDeps } from "../domain/ports.js";
import type { SearchEntry, SearchFileResult } from "../domain/models.js";
import log from "../shared/logger.js";

// Единый литерал строки выдачи для файла — те же поля, что у элемента cachePages
// (id/name/employer/area/salary/alternate_url), см. mapSearchItem в infrastructure/hh/client.ts.
function toSearchEntry(item: any): SearchEntry {
  return {
    id: String(item.id),
    title: item.name || '—',
    employer: item.employer?.name || '—',
    area: item.area?.name || '—',
    salary: fmtSalary(item.salary),
    url: item.alternate_url || `https://hh.ru/vacancy/${item.id}`,
  };
}

/** Сводка по догрузке полных карточек (ensureFullVacancies). */
export interface FullCardsSummary {
  candidates: number;
  cached: number;
  skippedSeen: number;
  saved: number;
  failed: number;
}

/** Фазы поиска: команда печатает их в том же порядке, в каком они происходили раньше. */
export type SearchEvent =
  | { type: 'reset'; text: string }
  | { type: 'found'; items: any[] }
  | { type: 'nothing-found' }
  | { type: 'files-saved'; results: SearchFileResult[]; added: number; total: number }
  | { type: 'files-unchanged'; results: SearchFileResult[]; total: number }
  | { type: 'files-failed'; message: string }
  | { type: 'full-cards'; summary: FullCardsSummary }
  | { type: 'full-cards-failed'; message: string }
  | { type: 'done' }
  | { type: 'search-failed-after-reset' };

/**
 * Поиск вакансий и догрузка описаний.
 * opts: { config?: string; reset?: boolean } — те же флаги, что были у команды.
 */
export async function runSearch(
  opts: Record<string, any> = {},
  deps: CollectDeps,
  report?: (event: SearchEvent) => void,
) {
  if (opts.config) process.env.CONFIG_PATH = opts.config;

  let didReset = false;
  if (opts.reset) {
    const summary = await resetData();
    report?.({ type: 'reset', text: formatResetSummary(summary) });
    didReset = true;
  }

  const client = new HHClient();

  try {
    const cfg = loadConfig();
    log.info('Searching vacancies', cfg.search);
    const cache = await collectCache.load();
    const items = await collectVacancies(client, cfg.search, cache, deps);

    report?.({ type: 'found', items });

    log.info(`Search done: ${items.length} vacancies collected (cached)`);
    if (!items.length) {
      report?.({ type: 'nothing-found' });
      return;
    }

    // Выдача в файл (data/search/): в файл за день дописываются только новые вакансии
    // (дедуп по id против уже записанных), ранее найденные строки сохраняются. Ошибка записи
    // не должна выглядеть как провал поиска: данные уже в Mongo, поэтому только логируем.
    try {
      const rows = flattenCollected(cache).map(toSearchEntry);
      const results = writeSearchResults(rows, { query: cfg.search.text });
      const added = results.reduce((n, r) => n + r.added, 0);
      const total = results.reduce((n, r) => n + r.total, 0);
      if (added > 0) {
        log.info(`Search results saved: ${results.length} regions, +${added} new, total ${total}`);
        report?.({ type: 'files-saved', results, added, total });
      } else if (results.length) {
        log.info(`Search results unchanged: ${results.length} regions, ${total} vacancies, no new`);
        report?.({ type: 'files-unchanged', results, total });
      } else {
        log.info('Search results: no vacancies to save');
      }
    } catch (err: any) {
      log.error(`Search file dump failed: ${err.message}`);
      report?.({ type: 'files-failed', message: err.message });
    }

    // Описания (cacheFull) нужны шагам digest и cover — забираем их сразу, пока открыт браузер.
    try {
      const full = await collectFullVacancies(client, items, cache, deps);
      report?.({ type: 'full-cards', summary: full });
    } catch (err: any) {
      // Страницы выдачи уже в кэше: падение на карточках не должно выглядеть как провал поиска.
      log.error(`Full vacancies failed: ${err.message}`);
      report?.({ type: 'full-cards-failed', message: err.message });
    }

    report?.({ type: 'done' });
  } catch (err: any) {
    // Если сброс уже прошёл, молчать нельзя: иначе это выглядит как «ничего не произошло».
    if (didReset) report?.({ type: 'search-failed-after-reset' });
    throw err;
  } finally {
    await client.close?.();
  }
}
