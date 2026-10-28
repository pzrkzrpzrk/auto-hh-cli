// Читатели страниц hh.ru на фейковой сессии: сборка query string и разбор ответов.
// Playwright не нужен — порт PageFetcher подменяется детерминированной заглушкой.
import { describe, expect, it } from "vitest";
import type { FetchOptions, PageFetcher, RawPageState } from "@/infrastructure/hh/session";
import HHVacancySearchReader from "@/infrastructure/hh/search-page-reader";
import HHVacancyPageReader from "@/infrastructure/hh/vacancy-page-reader";

function fakeFetcher(state: RawPageState): { fetcher: PageFetcher; urls: string[] } {
  const urls: string[] = [];
  const fetcher: PageFetcher = {
    async fetchInitialState(url: string, _opts?: FetchOptions): Promise<RawPageState> {
      urls.push(url);
      return state;
    },
  };
  return { fetcher, urls };
}

describe("HHVacancySearchReader", () => {
  it("собирает параметры выдачи в query string страницы hh.ru", async () => {
    const { fetcher, urls } = fakeFetcher({});
    await new HHVacancySearchReader(fetcher).searchVacancies({
      text: 'typescript',
      area: [1, 2],
      only_with_salary: true,
      per_page: 50,
      page: 1,
      order_by: 'publication_time',
      search_period: 7,
    });

    expect(urls[0]).toBe(
      'https://hh.ru/search/vacancy?text=typescript&area=1&area=2&only_with_salary=true'
      + '&items_on_page=50&page=1&search_period=7&order_by=publication_time',
    );
  });

  it("разбирает выдачу: элементы, найдено и число страниц", async () => {
    const { fetcher } = fakeFetcher({
      vacancySearchResult: {
        vacancies: [
          { vacancyId: 1, name: 'Frontend', compensation: { from: 100000 }, links: { desktop: 'https://hh.ru/vacancy/1' } },
          { vacancyId: 2, name: 'Backend' },
        ],
        totalResults: 120,
        paging: { lastPage: { page: 2 } },
      },
    });

    const result = await new HHVacancySearchReader(fetcher).searchVacancies({ text: 'dev' });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: '1',
      name: 'Frontend',
      salary: { from: 100000, to: null, currency: null },
      alternate_url: 'https://hh.ru/vacancy/1',
    });
    expect(result).toMatchObject({ found: 120, pages: 3 });
  });

  it("считает страницы по per_page, если paging не пришёл", async () => {
    const { fetcher } = fakeFetcher({
      vacancySearchResult: { vacancies: [{ vacancyId: 1, name: 'X' }], totalResults: 120 },
    });

    const result = await new HHVacancySearchReader(fetcher).searchVacancies({ per_page: 20 });
    expect(result.pages).toBe(6);
  });

  it("без vacancySearchResult отдаёт пустую выдачу", async () => {
    const { fetcher } = fakeFetcher({});
    const result = await new HHVacancySearchReader(fetcher).searchVacancies({ text: 'dev' });
    expect(result).toEqual({ items: [], found: 0, pages: 0 });
  });
});

describe("HHVacancyPageReader", () => {
  const dictionary = { employmentForm: [{ id: 'FULL', text: 'Полная занятость' }] };

  it("разбирает актуальную карточку vacancyFull.vacancy", async () => {
    const { fetcher, urls } = fakeFetcher({
      vacancyView: {
        vacancyFull: {
          vacancy: { vacancyId: 42, name: 'Frontend', employmentForm: 'FULL', status: { archived: false } },
          links: { desktop: 'https://hh.ru/vacancy/42?from=search' },
        },
      },
      vacancyFieldsDictionary: dictionary,
    });

    const vacancy = await new HHVacancyPageReader(fetcher).getVacancy(42);

    expect(urls[0]).toBe('https://hh.ru/vacancy/42');
    expect(vacancy).toMatchObject({
      id: '42',
      name: 'Frontend',
      employment: { name: 'Полная занятость' },
      archived: false,
      alternate_url: 'https://hh.ru/vacancy/42?from=search',
    });
  });

  it("поддерживает прежнюю форму vacancyView.vacancy", async () => {
    const { fetcher } = fakeFetcher({
      vacancyView: { vacancy: { vacancyId: 7, name: 'Legacy' } },
    });

    const vacancy = await new HHVacancyPageReader(fetcher).getVacancy(7);
    expect(vacancy).toMatchObject({ id: '7', name: 'Legacy' });
  });

  it("не отдаёт пустую карточку и отсутствие vacancyView", async () => {
    const empty = fakeFetcher({ vacancyView: { vacancyFull: { vacancy: {} } } });
    expect(await new HHVacancyPageReader(empty.fetcher).getVacancy(42)).toBeNull();

    const missing = fakeFetcher({});
    expect(await new HHVacancyPageReader(missing.fetcher).getVacancy(42)).toBeNull();
  });
});
