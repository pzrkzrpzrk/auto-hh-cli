// SearchScenario: страницы выдачи, файл, полные карточки и сброс — на фейковых портах.
// Тест фиксирует поведение до распила адаптеров hh.ru (T-25): ни базы, ни Playwright, ни data/.
import { describe, expect, it } from "vitest";
import { SearchScenario } from "@/application/search/SearchScenario";
import type { SearchEvent } from "@/application/search/SearchEvent";
import type { SearchEntry, SearchFileResult, Vacancy } from "@/domain/models";
import type {
  CacheStore,
  DataJanitor,
  HistoryMeta,
  HistoryState,
  HistoryStore,
  ResetSummary,
  SearchReportWriter,
} from "@/domain/ports";
import type { SearchCacheSnapshot, SearchPageResult } from "@/domain/search/types";
import type { VacancySource } from "@/domain/search/VacancySource";

const item = (id: string, name = `Vacancy ${id}`) => ({
  id,
  name,
  employer: { name: "ACME" },
  area: { name: "Москва" },
  alternate_url: `https://hh.ru/vacancy/${id}`,
});

const vacancy = (id: string): Vacancy => ({ id, name: `Vacancy ${id}`, description: "Описание" });

class FakeCache implements CacheStore {
  readonly savedPages: string[] = [];
  readonly savedFull: string[] = [];

  constructor(public snapshot: SearchCacheSnapshot) {}

  async load(): Promise<SearchCacheSnapshot> {
    return this.snapshot;
  }

  async savePage(_state: SearchCacheSnapshot, pageNum: number | string): Promise<void> {
    this.savedPages.push(String(pageNum));
  }

  async saveFullVacancy(full: Vacancy): Promise<void> {
    this.savedFull.push(String(full.id));
    this.snapshot.fullById[String(full.id)] = full;
  }

  async getFullByVacancyIds(): Promise<Record<string, Vacancy>> {
    return this.snapshot.fullById;
  }
}

class FakeHistory implements HistoryStore {
  readonly seenCalls: string[] = [];
  constructor(private readonly state: HistoryState = { applied: {}, seen: {} }) {}

  async load(): Promise<HistoryState> {
    return this.state;
  }

  async markSeen(vacancyId: string | number): Promise<void> {
    this.seenCalls.push(String(vacancyId));
  }

  async markApplied(_vacancyId: string | number, _meta: HistoryMeta): Promise<void> {}
}

class FakeSource implements VacancySource {
  readonly searched: number[] = [];
  readonly fetched: string[] = [];

  constructor(
    private readonly pages: Record<number, SearchPageResult>,
    private readonly full: (id: string) => Vacancy | null = id => vacancy(id),
  ) {}

  async searchVacancies(params: { page?: number }): Promise<SearchPageResult> {
    const page = params.page ?? 0;
    this.searched.push(page);
    return this.pages[page] ?? { items: [], found: 0, pages: 0 };
  }

  async getVacancy(id: string | number): Promise<Vacancy | null> {
    this.fetched.push(String(id));
    return this.full(String(id));
  }
}


class FakeWriter implements SearchReportWriter {
  readonly writes: SearchEntry[][] = [];

  async write(entries: SearchEntry[]): Promise<SearchFileResult[]> {
    this.writes.push(entries);
    return [{ file: "data/search/msk.md", added: entries.length, total: entries.length }];
  }
}

class FakeJanitor implements DataJanitor {
  readonly calls: string[] = [];
  async clearAll(): Promise<ResetSummary> {
    this.calls.push("all");
    return { db: [{ table: "history", deleted: 2 }], files: [], cache: [] };
  }
  async clearResume(): Promise<ResetSummary> {
    this.calls.push("resume");
    return { db: [{ table: "digest", deleted: 5 }], files: ["digest.md"], cache: [] };
  }
}

function setup(opts: {
  pages?: Record<number, SearchPageResult>;
  snapshot?: Partial<SearchCacheSnapshot>;
  history?: HistoryState;
  resume?: { name: string; id: string } | null;
}) {
  const snapshot: SearchCacheSnapshot = {
    date: "2026-10-28",
    pages: opts.snapshot?.pages ?? {},
    fullById: opts.snapshot?.fullById ?? {},
  };
  const cache = new FakeCache(snapshot);
  const history = new FakeHistory(opts.history);
  const source = new FakeSource(opts.pages ?? {});
  const writer = new FakeWriter();
  const janitor = new FakeJanitor();
  const events: SearchEvent[] = [];

  const deps = {
    cacheStore: cache,
    history,
    config: { load: () => ({ search: { text: "node", per_page: 2, max_pages: 2 } }) },
    source: { withSource: <R>(fn: (source: VacancySource) => Promise<R>) => fn(source) },
    janitor,
    reportWriter: writer,
    resumeFiles: {
      load: () => (opts.resume ? { ...opts.resume, type: "text" as const, text: "резюме", filename: "cv.md" } : null),
    },
  };

  return {
    run: (runOpts: Parameters<SearchScenario["run"]>[0] = {}) =>
      new SearchScenario(deps, event => events.push(event)).run(runOpts),
    events,
    cache,
    history,
    source,
    writer,
    janitor,
  };
}

describe("SearchScenario", () => {
  it("собирает страницы, пишет файл без дублей и догружает карточки", async () => {
    const harness = setup({
      pages: {
        0: { items: [item("1"), item("2")], found: 3, pages: 2 },
        1: { items: [item("2"), item("3")], found: 3, pages: 2 },
      },
    });

    await harness.run();

    expect(harness.source.searched).toEqual([0, 1]);
    expect(harness.cache.savedPages).toEqual(["0", "1"]);

    // В файл попадает плоский список без дублей: на страницах id 2 повторяется.
    expect(harness.writer.writes[0].map(row => row.id)).toEqual(["1", "2", "3"]);
    expect(harness.writer.writes[0][0]).toMatchObject({ title: "Vacancy 1", employer: "ACME", area: "Москва" });

    expect(harness.source.fetched).toEqual(["1", "2", "3"]);
    expect(harness.cache.savedFull).toEqual(["1", "2", "3"]);

    const types = harness.events.map(event => event.type);
    expect(types).toContain("found");
    expect(types).toContain("files-saved");
    expect(types[types.length - 1]).toBe("done");
  });

  it("пустая выдача останавливает поиск: без файла и карточек", async () => {
    const harness = setup({ pages: { 0: { items: [], found: 0, pages: 0 } } });

    await harness.run();

    expect(harness.events.map(event => event.type)).toEqual(["found", "nothing-found"]);
    expect(harness.writer.writes).toEqual([]);
    expect(harness.source.fetched).toEqual([]);
  });

  it("страница 0 запрашивается заново, страница 1 берётся из кэша", async () => {
    const harness = setup({
      pages: { 0: { items: [item("1")], found: 3, pages: 2 } },
      snapshot: { pages: { "0": [item("old")], "1": [item("2"), item("3")] } },
    });

    await harness.run();

    expect(harness.source.searched).toEqual([0]);
    expect(harness.cache.savedPages).toEqual(["0"]);
    expect(harness.source.fetched).toEqual(["1", "2", "3"]);
  });

  it("просмотренные не качаются: остаются только новые карточки", async () => {
    const harness = setup({
      pages: { 0: { items: [item("1"), item("2")], found: 2, pages: 1 } },
      history: { applied: {}, seen: { "1": "2026-10-27T10:00:00.000Z" } },
    });

    await harness.run();

    expect(harness.source.fetched).toEqual(["2"]);
  });

  it("--reset с резюме чистит только его данные и сообщает об этом", async () => {
    const harness = setup({
      pages: { 0: { items: [item("1")], found: 1, pages: 1 } },
      resume: { name: "backend", id: "r1" },
    });

    await harness.run({ reset: true });

    expect(harness.janitor.calls).toEqual(["resume"]);
    // Сводка печатает таблицы и кэш; файлы в тексте не участвуют.
    expect(harness.events[0]).toMatchObject({ type: "reset", text: "digest 5" });
  });

  it("--reset без резюме чистит всё", async () => {
    const harness = setup({ pages: { 0: { items: [item("1")], found: 1, pages: 1 } } });

    await harness.run({ reset: true });

    expect(harness.janitor.calls).toEqual(["all"]);
    expect(harness.events[0]).toMatchObject({ type: "reset", text: "history 2" });
  });
});
