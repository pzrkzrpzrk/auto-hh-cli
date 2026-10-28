// DigestScenario: сборка дайджеста без базы, браузера и ИИ — на фейковых портах.
// Проверяются ранние выходы, dry-run, лимит и запись артефактов.
import { describe, expect, it } from "vitest";
import { DigestScenario } from "@/application/digest/DigestScenario";
import type { DigestDeps } from "@/application/digest/DigestDeps";
import type { DigestEvent } from "@/application/digest/DigestEvent";
import type { DigestEntry, DigestDoc, Vacancy } from "@/domain/models";
import type { HistoryMeta, HistoryState, HistoryStore } from "@/domain/ports";
import type {
  CoverLetterCache,
  DigestCacheStore,
  DigestKind,
  DigestRepository,
  JudgementCache,
  RegisteredResume,
  ResumeRegistry,
} from "@/domain/digest/ports";
import type { DigestCacheSnapshot } from "@/domain/digest/types";
import type { VacancySource } from "@/domain/search/VacancySource";
import type { SearchCacheSnapshot } from "@/domain/search/types";

const full = (id: string, patch: Partial<Vacancy> = {}): Vacancy => ({
  id,
  name: `Vacancy ${id}`,
  description: "Описание вакансии, удалённая работа",
  employer: { name: "ACME" },
  area: { name: "Москва", id: 1 },
  alternate_url: `https://hh.ru/vacancy/${id}`,
  ...patch,
});

const snapshot = (fullById: Record<string, Vacancy>): DigestCacheSnapshot => ({
  date: "2026-10-28",
  pages: { "0": Object.keys(fullById).map(id => ({ id, name: `Vacancy ${id}` })) },
  fullById,
  judgements: {},
  coverLetters: {},
});

class FakeCache implements DigestCacheStore {
  constructor(private readonly doc: DigestCacheSnapshot | null) {}

  async loadLatest(): Promise<DigestCacheSnapshot | null> {
    return this.doc;
  }
  async load(): Promise<SearchCacheSnapshot> {
    return this.doc ?? { date: "2026-10-28", pages: {}, fullById: {} };
  }
  async savePage(): Promise<void> {}
  async saveFullVacancy(): Promise<void> {}
  async getFullByVacancyIds(): Promise<Record<string, Vacancy>> {
    return this.doc?.fullById ?? {};
  }
}

class FakeHistory implements HistoryStore {
  readonly seen: string[] = [];
  readonly applied: Array<{ id: string; meta: HistoryMeta }> = [];
  async load(): Promise<HistoryState> {
    return { applied: {}, seen: {} };
  }
  async markSeen(vacancyId: string | number): Promise<void> {
    this.seen.push(String(vacancyId));
  }
  async markApplied(vacancyId: string | number, meta: HistoryMeta): Promise<void> {
    this.applied.push({ id: String(vacancyId), meta });
  }
}

class FakeJudgements implements JudgementCache {
  async save(): Promise<void> {}
  async listResumeIds(): Promise<string[]> {
    return [];
  }
  async clearResume(): Promise<number> {
    return 0;
  }
}

class FakeDigests implements DigestRepository {
  readonly saves: Array<{ kind: DigestKind; entries: DigestEntry[] }> = [];
  async latest(): Promise<DigestDoc | null> {
    return null;
  }
  async byDate(): Promise<DigestEntry[]> {
    return [];
  }
  async all(): Promise<DigestEntry[]> {
    return [];
  }
  async listDocs(): Promise<DigestDoc[]> {
    return [];
  }
  async save(kind: DigestKind, entries: DigestEntry[]): Promise<string[]> {
    this.saves.push({ kind, entries });
    return [`${kind}.md`];
  }
  saveActual(): string | null {
    return null;
  }
}

class FakeResumes implements ResumeRegistry {
  async register(): Promise<{ created: boolean; changed: boolean }> {
    return { created: true, changed: false };
  }
  async listRegistered(): Promise<RegisteredResume[]> {
    return [];
  }
  async find(): Promise<RegisteredResume | null> {
    return null;
  }
}

class FakeLetters implements CoverLetterCache {
  async attach<T>(entries: T[]): Promise<T[]> {
    return entries;
  }
  async save(): Promise<void> {}
  async listResumeIds(): Promise<string[]> {
    return [];
  }
  async clearResume(): Promise<number> {
    return 0;
  }
}

function setup(opts: {
  snapshot?: DigestCacheSnapshot | null;
  filter?: Record<string, unknown>;
  resume?: boolean;
}) {
  const cache = new FakeCache(opts.snapshot === undefined ? snapshot({ "1": full("1") }) : opts.snapshot);
  const history = new FakeHistory();
  const digests = new FakeDigests();
  const events: DigestEvent[] = [];
  const sourceCalls: string[] = [];

  const deps: DigestDeps = {
    config: {
      load: () => ({ filter: opts.filter ?? {}, apply: { maxPerRun: 50 } }),
    },
    settings: { judgeBatchSize: 5, aiConcurrency: 2 },
    ai: () => null,
    aiAvailable: () => false,
    collect: { cacheStore: cache, history },
    source: {
      withSource: <R>(fn: (source: VacancySource) => Promise<R>) =>
        fn({
          searchVacancies: async () => ({ items: [], found: 0, pages: 0 }),
          getVacancy: async (id: string | number) => {
            sourceCalls.push(String(id));
            return null;
          },
        }),
    },
    judgements: new FakeJudgements(),
    digest: digests,
    resumes: new FakeResumes(),
    resumeFiles: {
      load: () => (opts.resume ? { name: "backend", id: "r1", type: "text" as const, text: "резюме", filename: "cv.md" } : null),
    },
    digestFiles: { latestContents: () => [] },
    coverLetters: new FakeLetters(),
  };

  return {
    build: (runOpts: Parameters<DigestScenario["build"]>[0] = {}) =>
      new DigestScenario(deps, { on: event => events.push(event) }).build(runOpts),
    events,
    history,
    digests,
    sourceCalls,
  };
}

describe("DigestScenario", () => {
  it("пустой кэш поиска — собирать нечего", async () => {
    const harness = setup({ snapshot: null });

    await expect(harness.build()).resolves.toBeNull();
    expect(harness.digests.saves).toEqual([]);
    expect(harness.events).toEqual([]);
  });

  it("кэш без вакансий останавливает конвейер до записи", async () => {
    const harness = setup({ snapshot: snapshot({}) });

    await expect(harness.build()).resolves.toBeNull();
    expect(harness.digests.saves).toEqual([]);
    expect(harness.history.seen).toEqual([]);
  });

  it("без резюме и ключа собирает по локальному фильтру и пишет артефакты", async () => {
    const harness = setup({
      snapshot: snapshot({ "1": full("1"), "2": full("2") }),
    });

    const result = await harness.build();

    expect(result?.dryRun).toBe(false);
    expect(result?.matched.map(row => row.id)).toEqual(["1", "2"]);
    expect(result?.rejected).toEqual([]);
    // Карточки уже в кэше: источник не дёргаем.
    expect(harness.sourceCalls).toEqual([]);
    expect(harness.digests.saves.map(save => save.kind)).toEqual(["rejected", "digest"]);
    expect(harness.digests.saves[1].entries).toHaveLength(2);
    // Отметки истории — digestOnly, заявки это не блокирует.
    expect(harness.history.applied.map(row => row.id)).toEqual(["1", "2"]);
    expect(harness.history.applied[0].meta).toMatchObject({ digestOnly: true });
    expect(harness.events.map(event => event.type)).toEqual(
      expect.arrayContaining(["matched", "digest-saved"]),
    );
  });

  it("dry-run ничего не пишет и не трогает историю", async () => {
    const harness = setup({ snapshot: snapshot({ "1": full("1") }) });

    const result = await harness.build({ dryRun: true });

    expect(result?.dryRun).toBe(true);
    expect(result?.matched).toHaveLength(1);
    expect(harness.digests.saves).toEqual([]);
    expect(harness.history.applied).toEqual([]);
    expect(harness.history.seen).toEqual([]);
  });

  it("лимит ограничивает дайджест", async () => {
    const harness = setup({ snapshot: snapshot({ "1": full("1"), "2": full("2") }) });

    const result = await harness.build({ limit: 1 });

    expect(result?.matched).toHaveLength(1);
    expect(harness.digests.saves[1].entries).toHaveLength(1);
  });

  it("локальный фильтр отбрасывает архивные вакансии до дайджеста", async () => {
    const harness = setup({
      snapshot: snapshot({ "1": full("1"), "2": full("2", { archived: true }) }),
      filter: { excludeArchived: true },
    });

    const result = await harness.build();

    expect(result?.matched.map(row => row.id)).toEqual(["1"]);
    expect(harness.digests.saves[1].entries).toHaveLength(1);
    // Просмотренными помечаются и принятые, и отброшенные — иначе они вернутся в выдачу.
    expect(harness.history.seen.sort()).toEqual(["1", "2"]);
  });
});
