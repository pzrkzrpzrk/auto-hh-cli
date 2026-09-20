// Команда search: поиск вакансий (страницы hh.ru → cachePages) + описания вакансий (cacheFull).
// Отбор + ИИ-судья — отдельный шаг `digest`, сопроводительные — отдельный шаг `cover`.
import HHClient from "../clients/hh-client";
import { loadConfig } from "../config";
import * as collectCache from "../store/cache-store.js";
import { collectVacancies, collectFullVacancies, fmtSalary } from "../domain/collect.js";
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

    // Описания (cacheFull) нужны шагам digest и cover — забираем их сразу, пока открыт браузер.
    try {
      const full = await collectFullVacancies(client, items, cache);
      const parts = [`+${full.saved}`];
      if (full.cached) parts.push(`уже в кэше ${full.cached}`);
      if (full.skippedSeen) parts.push(`просмотренных пропущено ${full.skippedSeen}`);
      if (full.failed) parts.push(`ошибок ${full.failed}`);
      console.log(`\nПолные карточки (cacheFull): ${parts.join(', ')} из ${full.candidates} найденных`);
      if (!full.saved && !full.failed) {
        console.log('Все карточки уже в кэше — за описаниями на hh.ru не ходили.');
      } else if (full.failed) {
        console.log('Недостающие описания digest и cover догрузят сами.');
      }
    } catch (err: any) {
      // Страницы выдачи уже в кэше: падение на карточках не должно выглядеть как провал поиска.
      log.error(`Full vacancies failed: ${err.message}`);
      console.error(`⚠️  Полные карточки не собрались: ${err.message}`);
      console.error('Страницы выдачи в кэше — digest и cover догрузят описания сами.');
    }

    console.log('\nДальше: auto-hh digest — локальный фильтр + ИИ-судья → дайджест');
  } finally {
    await client.close?.();
  }
}

export default search;
