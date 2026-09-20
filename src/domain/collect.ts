// Шаг «поиск»: сбор страниц выдачи hh.ru в кэш (cachePages) + хелперы для остальных шагов.
import * as collectCache from "../store/cache-store.js";
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

export { collectVacancies, flattenCollected, fmtSalary };
