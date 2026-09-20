// Команда search: только поиск вакансий (страницы hh.ru → кэш cachePages).
// Отбор + ИИ-судья — отдельный шаг `digest`, сопроводительные — отдельный шаг `cover`.
import HHClient from "../clients/hh-client";
import { loadConfig } from "../config";
import * as collectCache from "../store/cache-store.js";
import { collectVacancies, fmtSalary } from "../domain/collect.js";
import resetData from "../store/reset.js";
import log from "../logger.js";

const PREVIEW_LIMIT = 20;

async function search(opts: Record<string, any> = {}) {
  if (opts.config) process.env.CONFIG_PATH = opts.config;
  if (opts.reset) {
    await resetData();
  }

  const cfg = loadConfig();
  const client = new HHClient();

  try {
    log.info('Searching vacancies', cfg.search);
    const cache = await collectCache.load();
    const items = await collectVacancies(client, cfg.search, cache);

    console.log(`\n=== НАЙДЕНО: ${items.length} ===`);
    for (const item of items.slice(0, PREVIEW_LIMIT)) {
      console.log(`- ${item.name} @ ${item.employer?.name || '—'} | ${fmtSalary(item.salary)}`);
      console.log(`  ${item.alternate_url}`);
    }
    if (items.length > PREVIEW_LIMIT) {
      console.log(`... и ещё ${items.length - PREVIEW_LIMIT}`);
    }

    log.info(`Search done: ${items.length} vacancies collected (cached)`);
    if (!items.length) {
      console.log('\nНичего не найдено — проверьте config.search.');
      return;
    }
    console.log('\nДальше: auto-hh digest — локальный фильтр + ИИ-судья → дайджест');
  } finally {
    await client.close?.();
  }
}

export default search;
