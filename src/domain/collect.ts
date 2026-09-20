// Шаг «поиск»: сбор страниц выдачи hh.ru в кэш (cachePages) и полных карточек (cacheFull)
// + хелперы для остальных шагов.
import * as collectCache from "../store/cache-store.js";
import history from "../store/history-store.js";
import log from "../logger.js";

// Забирает страницы выдачи (start_page..start_page+max_pages) и складывает их в кэш.
// Страница 0 всегда запрашивается заново — на ней новые вакансии.
async function collectVacancies(client, search, cache) {
  const results = [];
  const startPage = search.start_page || 0;
  const maxPages = search.max_pages || 1;
  for (let page = startPage; page < startPage + maxPages; page++) {
    const cached = !page ? null : cache.pages[String(page)];
    if (cached) {
      log.info(`Page ${page}: ${cached.length} vacancies (cached)`);
      results.push(...cached);
      continue;
    }

    const params: Record<string, any> = {
      text: search.text,
      area: search.area,
      experience: search.experience,
      salary: search.salary,
      only_with_salary: search.only_with_salary,
      currency: search.currency,
      per_page: search.per_page || 50,
      page,
    };
    if (search.schedule) params.schedule = search.schedule;
    if (search.employment) params.employment = search.employment;

    const data = await client.searchVacancies(params);
    log.info(`Page ${page}: ${data.items.length} vacancies (total ${data.found})`);
    cache.pages[String(page)] = data.items;
    await collectCache.savePage(cache, page);
    results.push(...data.items);
    if (page + 1 >= (data.pages || 0)) break;
  }
  return results;
}

// Полные карточки вакансий (описание, навыки) — их читают шаги digest и cover.
// Качаем только то, чего ещё нет в кэше и что не попало в историю: просмотренные
// digest всё равно пропускает, а их карточки никому не нужны.
// Каждая карточка сохраняется сразу после загрузки — прерывание не теряет прогресс,
// повторный запуск продолжит с того же места.
async function collectFullVacancies(client, items, cache) {
  const stats = { candidates: 0, cached: 0, skippedSeen: 0, saved: 0, failed: 0 };
  const ids: string[] = [...new Set<string>(items.map(item => String(item.id)))];
  stats.candidates = ids.length;
  if (!ids.length) return stats;

  // cache.fullById — карточки текущей сессии поиска (ключ даты тот же, что читает digest).
  const seen = (await history.load().catch(() => ({ seen: {} }))).seen;
  const todo: string[] = [];
  for (const id of ids) {
    if (cache.fullById[id]) { stats.cached++; continue; }
    if (seen[id]) { stats.skippedSeen++; continue; }
    todo.push(id);
  }
  if (!todo.length) return stats;

  log.info(`Full vacancies to fetch: ${todo.length} (cached ${stats.cached}, seen skipped ${stats.skippedSeen})`);
  console.log(`\nПолные карточки: скачиваю ${todo.length} (в кэше уже ${stats.cached}, просмотренных пропущено ${stats.skippedSeen})`);
  if (todo.length > 100) {
    console.log(`⚠️  Это примерно ${Math.round(todo.length * 3 / 60)} мин. Ctrl+C безопасен: скачанное уже сохранено, повторный поиск продолжит.`);
  }

  const byId = new Map<string, any>(items.map(item => [String(item.id), item]));
  const date = cache.date ? new Date(`${cache.date}T00:00:00.000Z`) : undefined;
  for (const id of todo) {
    try {
      const full = await client.getVacancy(id);
      if (!full) {
        log.warn(`Empty vacancy ${id}, skipping`);
        stats.failed++;
      } else {
        cache.fullById[id] = full;
        await collectCache.saveFullVacancy(full, date);
        stats.saved++;
      }
    } catch (err) {
      log.warn(`Failed to fetch vacancy ${id}: ${err.message}`);
      stats.failed++;
    }

    const done = stats.saved + stats.failed;
    if (done % 10 === 0 || done === todo.length) {
      const name = byId.get(id)?.name || id;
      console.log(`  [${done}/${todo.length}] ${name}`);
      log.info(`Full cards: ${done}/${todo.length}`);
    }
  }
  return stats;
}

// Плоский список собранных вакансий без дублей — вход для шага digest.
function flattenCollected(cache): any[] {
  const byId = new Map<string, any>();
  for (const page of Object.keys(cache.pages || {})) {
    for (const item of cache.pages[page] || []) {
      const id = String(item.id);
      if (!byId.has(id)) byId.set(id, item);
    }
  }
  return [...byId.values()];
}

function fmtSalary(s) {
  if (!s) return '—';
  const parts = [];
  if (s.from) parts.push(`от ${s.from}`);
  if (s.to) parts.push(`до ${s.to}`);
  return `${parts.join(' ') || '?'} ${s.currency || ''}`.trim();
}

export { collectVacancies, collectFullVacancies, flattenCollected, fmtSalary };
