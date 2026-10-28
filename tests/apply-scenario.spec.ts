// ApplyScenario: правила пропуска, лимит и сессия — на фейковых портах.
// Playwright, SQLite и data/ не участвуют: сессия, история, письма и дайджест — фейки.
import { describe, expect, it } from "vitest";
import { ApplyScenario } from "@/application/apply/ApplyScenario";
import type { ApplyDeps } from "@/application/apply/ApplyDeps";
import type { DigestEntry, DigestDoc } from "@/domain/models";
import type {
  ApplicationGateway,
  ApplicationSession,
  ApplyResult,
  HistoryMeta,
  HistoryState,
  HistoryStore,
  LoginGateway,
} from "@/domain/ports";
import type { CoverLetterCache, DigestRepository } from "@/domain/digest/ports";

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
  coverLetter: "Здравствуйте!",
  ...patch,
});

class FakeDigests implements DigestRepository {
  lastResumeId?: string;
  lastKind?: string;

  constructor(private readonly entries: DigestEntry[]) {}

  async latest(): Promise<DigestDoc | null> {
    return { date: "2026-10-28", entries: this.entries };
  }
  async byDate(_date: string, resumeId?: string): Promise<DigestEntry[]> {
    this.lastKind = "byDate";
    this.lastResumeId = resumeId;
    return this.entries;
  }
  async all(resumeId?: string): Promise<DigestEntry[]> {
    this.lastKind = "all";
    this.lastResumeId = resumeId;
    return this.entries;
  }
  async listDocs(): Promise<DigestDoc[]> {
    return [];
  }
  async save(): Promise<string[]> {
    return [];
  }
  saveActual(): string | null {
    return null;
  }
}

class FakeLetters implements CoverLetterCache {
  async attach<T extends { id: string | number; coverLetter?: string; coverLetterResumeId?: string | null }>(entries: T[]): Promise<T[]> {
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

class FakeHistory implements HistoryStore {
  readonly applied: string[] = [];

  constructor(private readonly state: HistoryState = { applied: {}, seen: {} }) {}

  async load(): Promise<HistoryState> {
    return this.state;
  }
  async markSeen(): Promise<void> {}
  async markApplied(vacancyId: string | number, _meta: HistoryMeta): Promise<void> {
    this.applied.push(String(vacancyId));
  }
}

class FakeSession implements ApplicationSession {
  readonly applied: string[] = [];

  constructor(
    private readonly loggedIn = true,
    private readonly result: (id: string) => ApplyResult | Promise<ApplyResult> = () => ({ ok: true }),
  ) {}

  async ensureLoggedIn(): Promise<boolean> {
    return this.loggedIn;
  }

  async apply(row: DigestEntry): Promise<ApplyResult> {
    this.applied.push(String(row.id));
    return this.result(String(row.id));
  }
}

class FakeGateway implements ApplicationGateway {
  opened = 0;

  constructor(private readonly session: FakeSession) {}

  async withSession<R>(fn: (session: ApplicationSession) => Promise<R>): Promise<R> {
    this.opened++;
    return fn(this.session);
  }
}

class FakeLogin implements LoginGateway {
  calls = 0;
  async login(): Promise<void> {
    this.calls++;
  }
}

function setup(opts: {
  entries?: DigestEntry[];
  history?: HistoryState;
  loggedIn?: boolean;
  applyResult?: (id: string) => ApplyResult | Promise<ApplyResult>;
  resume?: { name: string; id: string };
}) {
  const session = new FakeSession(opts.loggedIn ?? true, opts.applyResult);
  const gateway = new FakeGateway(session);
  const history = new FakeHistory(opts.history);
  const login = new FakeLogin();
  const digests = new FakeDigests(opts.entries ?? []);

  const deps: ApplyDeps = {
    digests,
    letters: new FakeLetters(),
    history,
    gateway,
    login,
    resumeFiles: {
      load: (name?: string) =>
        opts.resume && (!name || name === opts.resume.name)
          ? { ...opts.resume, type: "text" as const, text: "резюме", filename: "cv.md" }
          : null,
    },
    settings: { minDelayMs: 0, maxDelayMs: 0 },
  };

  return {
    run: (runOpts: Parameters<ApplyScenario["run"]>[0] = {}) => new ApplyScenario(deps).run(runOpts),
    session,
    gateway,
    history,
    login,
    digests,
  };
}

describe("ApplyScenario", () => {
  it("без входа не откликается: сессия возвращает not-logged-in", async () => {
    const harness = setup({ entries: [entry("1")], loggedIn: false });

    await expect(harness.run()).resolves.toEqual({ kind: "not-logged-in" });
    expect(harness.session.applied).toEqual([]);
    expect(harness.history.applied).toEqual([]);
  });

  it("вакансия без письма пропускается и считается в skipped", async () => {
    const harness = setup({ entries: [entry("1", { coverLetter: "" })] });

    await expect(harness.run()).resolves.toEqual({ kind: "done", ok: 0, fail: 0, skipped: 1 });
    expect(harness.session.applied).toEqual([]);
  });

  it("уже откликались — пропуск без письма; digest-only отметка не блокирует", async () => {
    const harness = setup({
      entries: [entry("1"), entry("2")],
      history: {
        applied: { "1": { title: "old" }, "2": { title: "digest", digestOnly: true } },
        seen: {},
      },
    });

    await expect(harness.run()).resolves.toEqual({ kind: "done", ok: 1, fail: 0, skipped: 0 });
    expect(harness.session.applied).toEqual(["2"]);
    expect(harness.history.applied).toEqual(["2"]);
  });

  it("архивные отбрасываются до лимита", async () => {
    const harness = setup({
      entries: [entry("1", { archived: true }), entry("2"), entry("3")],
    });

    await expect(harness.run({ limit: 1 })).resolves.toEqual({ kind: "done", ok: 1, fail: 0, skipped: 0 });
    expect(harness.session.applied).toEqual(["2"]);
  });

  it("лимит ограничивает число откликов", async () => {
    const harness = setup({ entries: [entry("1"), entry("2"), entry("3")] });

    await expect(harness.run({ limit: 2 })).resolves.toEqual({ kind: "done", ok: 2, fail: 0, skipped: 0 });
    expect(harness.session.applied).toEqual(["1", "2"]);
  });

  it("отказ сессии и исключение считаются неудачей", async () => {
    const harness = setup({
      entries: [entry("1"), entry("2")],
      applyResult: id => {
        if (id === "1") return { ok: false, reason: "limit" };
        throw new Error("boom");
      },
    });

    await expect(harness.run()).resolves.toEqual({ kind: "done", ok: 0, fail: 2, skipped: 0 });
    expect(harness.history.applied).toEqual([]);
  });

  it("--login открывает ручной вход и не трогает дайджест", async () => {
    const harness = setup({ entries: [entry("1")] });

    await expect(harness.run({ login: true })).resolves.toEqual({ kind: "login" });
    expect(harness.login.calls).toBe(1);
    expect(harness.gateway.opened).toBe(0);
  });

  it("явное резюме, которого нет, даёт no-resume и не открывает браузер", async () => {
    const harness = setup({ entries: [entry("1")] });

    await expect(harness.run({ resume: "нет-такого" })).resolves.toEqual({ kind: "no-resume", name: "нет-такого" });
    expect(harness.gateway.opened).toBe(0);
  });

  it("явное резюме фильтрует дайджест: resumeId уходит в выборку", async () => {
    const harness = setup({ entries: [entry("1")], resume: { name: "backend", id: "r1" } });

    await harness.run({ resume: "backend" });

    expect(harness.digests.lastKind).toBe("byDate");
    expect(harness.digests.lastResumeId).toBe("r1");
  });

  it("--type all читает все сохранённые дайджесты", async () => {
    const harness = setup({ entries: [entry("1")] });

    await harness.run({ type: "all" });

    expect(harness.digests.lastKind).toBe("all");
    expect(harness.session.applied).toEqual(["1"]);
  });
});
