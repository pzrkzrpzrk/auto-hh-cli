// cache-store на :memory:: страницы и полные карточки читаются тем же снимком,
// а loadLatest отдаёт последнюю дату поиска (digest запускается на следующий день).
import { beforeEach, describe, expect, it } from "vitest";
import { clearTable, connect } from "@/infrastructure/sqlite/db";
import * as cacheStore from "@/infrastructure/sqlite/cache-store";
import type { Vacancy } from "@/domain/models";

const vacancy = (id: string): Vacancy => ({ id, name: `Vacancy ${id}`, description: "Описание" });

beforeEach(() => {
  connect({ file: ":memory:" });
  clearTable("cache_pages");
  clearTable("cache_full");
});

describe("cache-store", () => {
  it("сохраняет страницу и возвращает её в снимке за сегодня", async () => {
    const date = new Date();
    const state = await cacheStore.load(date);
    state.pages["0"] = [{ id: "1", name: "Vacancy 1" }];

    await cacheStore.savePage(state, 0, date);
    const snapshot = await cacheStore.load(date);

    expect(snapshot.pages["0"]).toEqual([{ id: "1", name: "Vacancy 1" }]);
  });

  it("сохраняет полную карточку и ищет её по id без дублей", async () => {
    await cacheStore.saveFullVacancy(vacancy("1"));

    const found = await cacheStore.getFullByVacancyIds(["1", 1, "2"]);

    expect(Object.keys(found)).toEqual(["1"]);
    expect(found["1"].name).toBe("Vacancy 1");
  });

  it("loadLatest берёт последнюю дату, по которой есть страницы", async () => {
    expect(await cacheStore.loadLatest()).toBeNull();

    const older = await cacheStore.load(new Date("2026-10-27T00:00:00.000Z"));
    older.pages["0"] = [{ id: "old", name: "Old" }];
    await cacheStore.savePage(older, 0, new Date("2026-10-27T00:00:00.000Z"));

    const fresh = await cacheStore.load(new Date("2026-10-28T00:00:00.000Z"));
    fresh.pages["0"] = [{ id: "new", name: "New" }];
    await cacheStore.savePage(fresh, 0, new Date("2026-10-28T00:00:00.000Z"));

    const latest = await cacheStore.loadLatest();

    expect(latest?.date).toBe("2026-10-28");
    expect(latest?.pages["0"]).toEqual([{ id: "new", name: "New" }]);
  });

  it("повторная запись страницы заменяет её содержимое", async () => {
    const date = new Date("2026-10-28T00:00:00.000Z");
    const state = await cacheStore.load(date);
    state.pages["0"] = [{ id: "1", name: "First" }];
    await cacheStore.savePage(state, 0, date);

    state.pages["0"] = [{ id: "2", name: "Second" }];
    await cacheStore.savePage(state, 0, date);

    const snapshot = await cacheStore.load(date);

    expect(snapshot.pages["0"]).toEqual([{ id: "2", name: "Second" }]);
  });
});
