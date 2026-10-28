// Актуализация дайджестов: окно поиска, идемпотентность и слияние дат.
import { describe, expect, it } from "vitest";
import { computeActualization, mergeActualized } from "@/domain/actualize";
import type { DigestDoc, DigestEntry } from "@/domain/models";

function entry(id: string, extra: Partial<DigestEntry> = {}): DigestEntry {
  return {
    id,
    title: `вакансия ${id}`,
    employer: "E",
    area: "Москва",
    salary: "",
    url: `https://hh.ru/vacancy/${id}`,
    score: 5,
    reason: null,
    comment: null,
    coverLetter: "",
    publishedAt: "2026-10-20",
    ...extra,
  };
}

function doc(date: string, entries: DigestEntry[]): DigestDoc {
  return { date, entries } as DigestDoc;
}

describe("computeActualization", () => {
  it("не трогает документы сегодняшнего и будущих дней", () => {
    const { docs, stats } = computeActualization([doc("2026-10-28", [entry("1")])], {
      todayIds: new Set(),
      today: "2026-10-28",
    });
    expect(docs).toHaveLength(0);
    expect(stats.dates).toBe(0);
  });

  it("вакансия из выдачи остаётся живой, пропавшая — архив", () => {
    const { docs, stats } = computeActualization(
      [doc("2026-10-27", [entry("1"), entry("2")])],
      { todayIds: new Set(["1"]), today: "2026-10-28" },
    );
    const [live, gone] = docs[0].entries;
    expect(live.archived).toBe(false);
    expect(live.lastSeenAt).toBe("2026-10-28");
    expect(live.checkedAt).toBe("2026-10-28");
    expect(gone.archived).toBe(true);
    expect(gone.lastSeenAt).toBeNull();
    expect(stats).toMatchObject({ dates: 1, total: 2, marked: 1, unmarked: 1, changedDates: 1 });
  });

  it("вакансия старше окна поиска не помечается архивом", () => {
    const [updated] = computeActualization(
      [doc("2026-10-27", [entry("1", { publishedAt: "2026-01-01" })])],
      { todayIds: new Set(), today: "2026-10-28", searchPeriod: 7 },
    ).docs[0].entries;
    expect(updated.archived).toBe(false);
    expect(updated.checkedAt).toBe("2026-10-28");
  });

  it("повторный прогон в тот же день ничего не меняет", () => {
    const first = computeActualization(
      [doc("2026-10-27", [entry("1"), entry("2", { publishedAt: "2026-01-01" })])],
      { todayIds: new Set(["1"]), today: "2026-10-28", searchPeriod: 7 },
    );
    const again = computeActualization(
      [doc("2026-10-27", first.docs[0].entries)],
      { todayIds: new Set(["1"]), today: "2026-10-28", searchPeriod: 7 },
    );
    expect(again.stats.changedDates).toBe(0);
  });
});

describe("mergeActualized", () => {
  it("дедуп по id: побеждает запись из самой свежей даты", () => {
    const merged = mergeActualized([
      { date: "2026-10-26", entries: [entry("1", { score: 3 })], changed: false },
      { date: "2026-10-27", entries: [entry("1", { score: 9 })], changed: true },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(9);
  });

  it("живые выше архивных, внутри группы — по убыванию оценки", () => {
    const merged = mergeActualized([
      {
        date: "2026-10-27",
        changed: true,
        entries: [
          entry("archived", { archived: true, score: 10 }),
          entry("low", { archived: false, score: 2 }),
          entry("high", { archived: false, score: 8 }),
        ],
      },
    ]);
    expect(merged.map(e => e.id)).toEqual(["high", "low", "archived"]);
  });
});
