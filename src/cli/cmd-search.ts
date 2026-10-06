// Команда search: поиск вакансий (страницы hh.ru → cachePages) + описания вакансий (cacheFull).
// Отбор + ИИ-судья — отдельный шаг `digest`, сопроводительные — отдельный шаг `cover`.
import HHClient from "../clients/hh-client.js";
import { loadConfig } from "../config.js";
import * as collectCache from "../store/cache-store.js";
import { collectVacancies, collectFullVacancies, flattenCollected, fmtSalary } from "../domain/collect.js";
import resetData, { formatResetSummary } from "../store/reset.js";
import { writeSearchResults } from "../store/search-store.js";
import type { SearchEntry } from "../types.js";
import log from "../logger.js";

const PREVIEW_LIMIT = 20;

// Единый литерал строки выдачи для файла — те же поля, что у элемента cachePages
// (id/name/employer/area/salary/alternate_url), см. mapSearchItem в clients/hh-client.ts.
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

async function search(opts: Record<string, any> = {}) {
  if (opts.config) process.env.CONFIG_PATH = opts.config;

  let didReset = false;
  if (opts.reset) {
    const summary = await resetData();
    const text = formatResetSummary(summary);
    console.log(text ? `Сброшено перед поиском: ${text}` : 'Сброшено: данные уже были пусты.');
    didReset = true;
  }

  const client = new HHClient();

  try {
    const cfg = loadConfig();
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

    // Выдача в файл (data/search/): в файл за день дописываются только новые вакансии
    // (дедуп по id против уже записанных), ранее найденные строки сохраняются. Ошибка записи
    // не должна выглядеть как провал поиска: данные уже в Mongo, поэтому только логируем.
    try {
      const rows = flattenCollected(cache).map(toSearchEntry);
      const saved = writeSearchResults(rows, { query: cfg.search.text });
      if (saved && saved.added > 0) {
        log.info(`Search results saved: ${saved.file} (+${saved.added} new, total ${saved.total})`);
        console.log(`\nВыдача сохранена: ${saved.file} (+${saved.added} новых, всего ${saved.total})`);
      } else if (saved) {
        log.info(`Search results unchanged: ${saved.file} (${saved.total} vacancies, no new)`);
        console.log(`\nНовых вакансий нет — файл не изменился (${saved.file})`);
      }
    } catch (err: any) {
      log.error(`Search file dump failed: ${err.message}`);
      console.error(`⚠️  Выдачу не удалось сохранить в файл: ${err.message}`);
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

    console.log('\nДальше: пункт меню «🧠 Собрать дайджест» — локальный фильтр + ИИ-судья');
  } catch (err: any) {
    // Если сброс уже прошёл, молчать нельзя: иначе это выглядит как «ничего не произошло».
    if (didReset) {
      console.error('\nПоиск не выполнился, но история, кэш и дайджесты уже сброшены.');
      console.error('Повторите: пункт меню «🔍 Поиск вакансий»');
    }
    throw err;
  } finally {
    await client.close?.();
  }
}

export default search;
