// Читатель страницы выдачи: собирает query string hh.ru, забирает initial state
// и разбирает vacancySearchResult чистым маппингом.
import log from "@/shared/logger.js";
import type { SearchParams, SearchPageResult } from "@/domain/search/types.js";
import type { PageFetcher } from "@/infrastructure/hh/session.js";
import { mapSearchItem } from "@/infrastructure/hh/vacancy-mapping.js";

class HHVacancySearchReader {
  constructor(private readonly pages: PageFetcher) {}

  async searchVacancies(params: SearchParams): Promise<SearchPageResult> {
    const sp = new URLSearchParams();
    if (params.text) sp.set('text', params.text);
    if (params.area != null) {
      if (Array.isArray(params.area)) {
        for (const id of params.area) sp.append('area', String(id));
      } else {
        sp.set('area', String(params.area));
      }
    }
    if (params.experience) sp.set('experience', params.experience);
    if (params.salary) sp.set('salary', String(params.salary));
    if (params.only_with_salary) sp.set('only_with_salary', 'true');
    if (params.currency) sp.set('currency_code', params.currency);
    if (params.per_page) sp.set('items_on_page', String(params.per_page));
    if (params.page != null) sp.set('page', String(params.page));
    if (params.schedule) sp.set('schedule', params.schedule);
    if (params.employment) sp.set('employment', params.employment);
    // Дата публикации: только вакансии за последние N дней (0/null — без ограничения).
    if (params.search_period != null) sp.set('search_period', String(params.search_period));
    // Порядок выдачи: relevance | publication_time | salary_desc | salary_asc.
    if (params.order_by) sp.set('order_by', params.order_by);

    const url = `https://hh.ru/search/vacancy?${sp.toString()}`;
    const data = await this.pages.fetchInitialState(url);
    const vsr = data.vacancySearchResult;
    if (!vsr) {
      log.warn(`No vacancySearchResult on ${url}`);
      return { items: [], found: 0, pages: 0 };
    }
    const items = (vsr.vacancies || []).map(mapSearchItem);
    const found = vsr.totalResults || items.length;
    const perPage = params.per_page || 50;
    const pages = vsr.paging?.lastPage?.page != null
      ? vsr.paging.lastPage.page + 1
      : Math.ceil(found / perPage);
    return { items, found, pages };
  }
}

export default HHVacancySearchReader;
