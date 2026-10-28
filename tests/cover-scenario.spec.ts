// CoverScenario: проверки резюме, пустой дайджест и письма из кэша — на фейковых портах.
// ИИ, Playwright и SQLite отсутствуют: шаблон письма и кэш писем — фейки.
import { describe, expect, it } from "vitest";
import { CoverScenario } from "@/application/cover/CoverScenario";
import { CoverSettings } from "@/domain/cover-letter/config";
import type { DigestEntry, DigestDoc, Vacancy } from "@/domain/models";
import type { HistoryMeta, HistoryState, HistoryStore } from "@/domain/ports";
import type { CoverLetterCache, DigestRepository } from "@/domain/digest/ports";
import type { SearchCacheSnapshot } from "@/domain/search/types";
import type { VacancySource } from "@/domain/search/VacancySource";

const entry = (id: string, patch: Partial<DigestEntry> = {}): DigestEntry => ({
  id,
  title: `Vacancy ${id}`,
  employer: "ACME",
  area: "Москва",
  salary: "100 000 ₽",
  url: `https://hh.ru/vacancy/${id}`,
  score: 8,
  reason: null,
  comment: "подходит",
  coverLetter: "",
  ...patch,
});

const fullCard = (id: string): Vacancy => ({ id, name: `Vacancy ${id}`, description: "Описание вакансии" });

class FakeDigests implements DigestRepository {
  readonly saved: DigestEntry[][] = [];
  constructor(private readonly doc: DigestDoc | null) {}

  async latest(): Promise<DigestDoc | null> {
    return this.doc;
  }
  async byDate(): Promise<DigestEntry[]> {
    return this.doc?.entries ?? [];
  }
  async all(): Promise<DigestEntry[]> {
    return this.doc?.entries ?? [];
  }
  async listDocs(): Promise<DigestDoc[]> {
    return [];
  }
  async save(_kind: "digest" | "rejected", entries: DigestEntry[]): Promise<string[]> {
    this.saved.push(entries);
    return ["digest.md"];
  }
  saveActual(): string | null {
    return null;
  }
}

class FakeLetters implements CoverLetterCache {
  readonly saved: string[] = [];
  attachCalls: Array<{ force?: boolean; resumeId?: string }> = [];

  /** Письма, «уже лежащие» в кэше: id → текст. */
  constructor(private readonly cached: Record<string, string> = {}) {}

  async attach<T extends { id: string | number; coverLetter?: string }>(
    entries: T[],
    opts: { force?: boolean; resumeId?: string } = {},
  ): Promise<T[]> {
    this.attachCalls.push(opts);
    if (opts.force) return entries;
    return entries.map(row => ({ ...row, coverLetter: this.cached[String(row.id)] ?? row.coverLetter ?? "" }));
  }

  async save(vacancyId: string | number): Promise<void> {
    this.saved.push(String(vacancyId));
  }
  async listResumeIds(): Promise<string[]> {
    return [];
  }
  async clearResume(): Promise<number> {
    return 0;
  }
}

class FakeHistory implements HistoryStore {
  async load(): Promise<HistoryState> {
    return { applied: {}, seen: {} };
  }
  async markSeen(): Promise<void> {}
  async markApplied(_id: string | number, _meta: HistoryMeta): Promise<void> {}
}

class FakeCacheStore {
  constructor(private readonly cards: Record<string, Vacancy> = {}) {}
  async load(): Promise<SearchCacheSnapshot> {
    return { date: "2026-10-28", pages: {}, fullById: this.cards };
  }
  async savePage(): Promise<void> {}
  async saveFullVacancy(): Promise<void> {}
  async getFullByVacancyIds(ids: (string | number)[]): Promise<Record<string, Vacancy>> {
    return Object.fromEntries(ids.filter(id => this.cards[String(id)]).map(id => [String(id), this.cards[String(id)]]));
  }
}

const DEFAULT_DOC: DigestDoc = { date: "2026-10-28", entries: [entry("1")], resumeId: "r1" };

function setup(opts: {
  doc?: DigestDoc | null;
  resume?: boolean;
  cached?: Record<string, string>;
  cards?: Record<string, Vacancy>;
  sourceCards?: Record<string, Vacancy>;
}) {
  const digests = new FakeDigests(opts.doc === undefined ? DEFAULT_DOC : opts.doc);
  const letters = new FakeLetters(opts.cached);
  const cacheStore = new FakeCacheStore(opts.cards);
  const source = {
    withSource: <R>(fn: (source: VacancySource) => Promise<R>) =>
      fn({
        searchVacancies: async () => ({ items: [], found: 0, pages: 0 }),
        getVacancy: async (id: string | number) => opts.sourceCards?.[String(id)] ?? null,
      }),
  };

  const deps = {
    ai: () => null,
    config: () => CoverSettings.from({ coverLetterTemplate: "Здравствуйте! Вакансия {name}" }),
    collect: { cacheStore, history: new FakeHistory() },
    source,
    resumeFiles: {
      load: () =>
        opts.resume === false
          ? null
          : { name: "backend", id: "r1", type: "text" as const, text: "резюме", filename: "cv.md" },
    },
    digests,
    letters,
  };

  return {
    run: (id?: string, runOpts: Parameters<CoverScenario["run"]>[1] = {}) =>
      new CoverScenario(deps).run(id, runOpts),
    digests,
    letters,
  };
}

describe("CoverScenario", () => {
  it("без резюме письма не генерируются", async () => {
    const harness = setup({ resume: false });

    await expect(harness.run()).resolves.toEqual({ kind: "no-resume" });
    expect(harness.letters.attachCalls).toEqual([]);
  });

  it("пустой дайджест — исход empty", async () => {
    const harness = setup({ doc: null });

    await expect(harness.run()).resolves.toEqual({ kind: "empty" });
  });

  it("письма уже в кэше: генерация не запускается, исход digest", async () => {
    const harness = setup({ cached: { "1": "готовое письмо" } });

    const outcome = await harness.run();

    expect(outcome.kind).toBe("digest");
    if (outcome.kind !== "digest") return;
    expect(outcome.letters.get("1")).toBe("готовое письмо");
    expect(harness.letters.saved).toEqual([]);
    expect(harness.digests.saved).toEqual([]);
    expect(harness.letters.attachCalls[0]).toEqual({ force: false, resumeId: "r1" });
  });

  it("force перегенерирует письма: кэш не подставляется", async () => {
    const harness = setup({ cached: { "1": "старое письмо" }, cards: { "1": fullCard("1") } });

    const outcome = await harness.run(undefined, { force: true });

    expect(harness.letters.attachCalls[0]).toMatchObject({ force: true });
    expect(outcome.kind).toBe("digest");
    // ИИ нет — пачка писем пуста, письмо не появилось и дайджест не перезаписан.
    if (outcome.kind === "digest") expect(outcome.letters.size).toBe(0);
    expect(harness.digests.saved).toEqual([]);
  });

  it("нет описаний вакансий — исход empty, письма не пишутся", async () => {
    const harness = setup({ cached: {}, cards: {}, sourceCards: {} });

    await expect(harness.run(undefined, { force: true })).resolves.toEqual({ kind: "empty" });
    expect(harness.letters.saved).toEqual([]);
  });

  it("лимит ограничивает срез дайджеста до прикрепления писем", async () => {
    const doc: DigestDoc = {
      date: "2026-10-28",
      entries: [entry("1"), entry("2")],
      resumeId: "r1",
    };
    const harness = setup({ doc, cached: { "1": "письмо 1", "2": "письмо 2" } });

    const outcome = await harness.run(undefined, { limit: 1 });

    expect(outcome.kind).toBe("digest");
    if (outcome.kind === "digest") expect([...outcome.letters.keys()]).toEqual(["1"]);
  });
});
