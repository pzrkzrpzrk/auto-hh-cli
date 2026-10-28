// DbJanitor на :memory:: точечный сброс одного резюме не трогает чужие строки.
import { beforeEach, describe, expect, it } from "vitest";
import { clearTable, connect } from "@/infrastructure/sqlite/db";
import DbJanitor from "@/infrastructure/sqlite/db-janitor";

const resume = { id: "r1", name: "R1" };
const other = { id: "r2", name: "R2" };
const TABLES = ["digests", "cache_judgements", "cache_cover_letters", "history", "cache_pages", "cache_full"];

function count(sql: string): number {
  return Number((connect().prepare(sql).get() as { c: number }).c);
}

/** Чистая база перед каждым тестом: по две записи на резюме и общий кэш поиска. */
function seed(): void {
  const conn = connect();
  for (const table of TABLES) clearTable(table);

  const insertDigest = conn.prepare(
    `INSERT INTO digests (kind, date, resume_id, resume_name, updated_at, entries)
     VALUES (?, '2026-10-28', ?, ?, '2026-10-28T00:00:00Z', '[]')`,
  );
  insertDigest.run("digest", resume.id, resume.name);
  insertDigest.run("rejected", resume.id, resume.name);
  insertDigest.run("digest", other.id, other.name);

  conn.prepare(`INSERT INTO cache_judgements (date, resume_id, vacancy_id, score)
    VALUES ('2026-10-28', ?, 'v1', 1)`).run(resume.id);
  conn.prepare(`INSERT INTO cache_cover_letters (resume_id, vacancy_id, date, letter)
    VALUES (?, 'v1', '2026-10-28', 'hi')`).run(resume.id);
  conn.prepare(`INSERT INTO cache_pages (date, page, items) VALUES ('2026-10-28', '0', '[]')`).run();
  conn.prepare(`INSERT INTO cache_full (vacancy_id, date, full) VALUES ('v1', '2026-10-28', '{}')`).run();

  const insertHistory = conn.prepare(
    `INSERT INTO history (vacancy_id, status, at, meta) VALUES (?, 'applied', 1, ?)`,
  );
  insertHistory.run("v1", JSON.stringify({ resumeId: resume.id }));
  insertHistory.run("other-1", JSON.stringify({ resumeId: other.id }));
}

describe("DbJanitor", () => {
  beforeEach(seed);

  it("clearResume чистит строки только выбранного резюме", () => {
    const { db, cache } = new DbJanitor().clearResume(resume);

    expect(count("SELECT COUNT(*) c FROM digests WHERE resume_id = 'r1'")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM digests WHERE resume_id = 'r2'")).toBe(1);
    expect(count("SELECT COUNT(*) c FROM cache_judgements WHERE resume_id = 'r1'")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM cache_cover_letters WHERE resume_id = 'r1'")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM history WHERE vacancy_id = 'v1'")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM history WHERE vacancy_id = 'other-1'")).toBe(1);

    // Кэш поиска общий: без флага его не трогаем.
    expect(count("SELECT COUNT(*) c FROM cache_pages")).toBe(1);
    expect(cache).toEqual([]);
    expect(db.map(r => r.table)).toEqual(["digest", "rejected", "cache_judgements", "cache_cover_letters", "history"]);
    expect(db.every(r => r.deleted === 1)).toBe(true);
  });

  it("includeSearchCache очищает общий кэш и попадает в сводку", () => {
    const { cache } = new DbJanitor().clearResume(resume, { includeSearchCache: true });

    expect(count("SELECT COUNT(*) c FROM cache_pages")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM cache_full")).toBe(0);
    expect(cache).toEqual(["cache_pages: 1", "cache_full: 1"]);
  });

  it("clearAll очищает историю, дайджесты и rejected", () => {
    const db = new DbJanitor().clearAll();

    expect(count("SELECT COUNT(*) c FROM history")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM digests")).toBe(0);
    expect(db.map(r => `${r.table}:${r.deleted}`)).toEqual(["history:2", "digest:2", "rejected:1"]);
  });
});
