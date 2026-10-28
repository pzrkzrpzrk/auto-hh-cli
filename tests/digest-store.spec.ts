// digest-store на :memory:: выборка по резюме, legacy-fallback и порядок дат.
// Артефакты .md не пишутся: строки дайджеста вставляются напрямую, проверяется SQL.
import { beforeEach, describe, expect, it } from "vitest";
import { clearTable, connect } from "@/infrastructure/sqlite/db";
import * as digestStore from "@/infrastructure/sqlite/digest-store";
import type { DigestEntry } from "@/domain/models";

const entry = (id: string): DigestEntry => ({
  id,
  title: `Vacancy ${id}`,
  employer: "ACME",
  area: "Москва",
  salary: "",
  url: `https://hh.ru/vacancy/${id}`,
  score: null,
  reason: null,
  comment: null,
  coverLetter: "",
});

function insert(opts: {
  kind?: "digest" | "rejected";
  date: string;
  resumeId?: string;
  entries: DigestEntry[];
  updatedAt?: string;
}): void {
  connect()
    .prepare(
      `INSERT INTO digests (kind, date, resume_id, resume_name, updated_at, entries)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.kind ?? "digest",
      opts.date,
      opts.resumeId ?? "",
      opts.resumeId ? `Resume ${opts.resumeId}` : "",
      opts.updatedAt ?? `${opts.date}T00:00:00Z`,
      JSON.stringify(opts.entries),
    );
}

beforeEach(() => {
  connect({ file: ":memory:" });
  clearTable("digests");
});

describe("digest-store", () => {
  it("getDigestsByDate отдаёт записи выбранного резюме", async () => {
    insert({ date: "2026-10-28", resumeId: "r1", entries: [entry("1")] });
    insert({ date: "2026-10-28", resumeId: "r2", entries: [entry("2")] });

    const rows = await digestStore.getDigestsByDate("digest", "2026-10-28", "r1");

    expect(rows.map(row => row.id)).toEqual(["1"]);
  });

  it("без своей записи getDigestsByDate падает в legacy-документ", async () => {
    insert({ date: "2026-10-28", entries: [entry("legacy")] });

    const rows = await digestStore.getDigestsByDate("digest", "2026-10-28", "r9");

    expect(rows.map(row => row.id)).toEqual(["legacy"]);
  });

  it("getLatestDigest берёт свежий документ резюме, legacy — как fallback", async () => {
    insert({ date: "2026-10-27", resumeId: "r1", entries: [entry("old")] });
    insert({ date: "2026-10-28", resumeId: "r1", entries: [entry("new")] });
    // Legacy-документ записан позже — при равной дате выигрывает по updated_at.
    insert({ date: "2026-10-28", entries: [entry("legacy")], updatedAt: "2026-10-28T12:00:00Z" });

    const own = await digestStore.getLatestDigest("r1");
    const foreign = await digestStore.getLatestDigest("r2");
    const any = await digestStore.getLatestDigest();

    expect(own?.entries.map(row => row.id)).toEqual(["new"]);
    expect(own?.resumeId).toBe("r1");
    expect(foreign?.entries.map(row => row.id)).toEqual(["legacy"]);
    expect(foreign?.resumeId).toBeNull();
    expect(any?.entries.map(row => row.id)).toEqual(["legacy"]);
  });

  it("rejected и digest не смешиваются", async () => {
    insert({ kind: "digest", date: "2026-10-28", resumeId: "r1", entries: [entry("1")] });
    insert({ kind: "rejected", date: "2026-10-28", resumeId: "r1", entries: [entry("2")] });

    const rejected = await digestStore.listDigestDocs("rejected", "r1");

    expect(rejected).toHaveLength(1);
    expect(rejected[0].entries.map(row => row.id)).toEqual(["2"]);
  });
});
