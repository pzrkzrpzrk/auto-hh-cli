// history-store на :memory:: отклик не затирается отметкой «просмотрено».
// Инвариант нужен apply: иначе после digest вакансия снова выглядит непросмотренной.
import { beforeEach, describe, expect, it } from "vitest";
import { clearTable, connect } from "@/infrastructure/sqlite/db";
import history from "@/infrastructure/sqlite/history-store";

beforeEach(() => {
  connect({ file: ":memory:" });
  clearTable("history");
});

describe("history-store", () => {
  it("markApplied сохраняет мету и время, load отдаёт applied", async () => {
    await history.markApplied("1", { title: "Backend", employer: "ACME", score: 8, digestOnly: true });

    const state = await history.load();

    expect(state.applied["1"]).toMatchObject({ title: "Backend", employer: "ACME", score: 8, digestOnly: true });
    expect(typeof state.seen["1"]).toBe("string");
  });

  it("markSeen не затирает реальный отклик", async () => {
    await history.markApplied("1", { title: "Backend" });
    const before = (await history.load()).seen["1"];

    await new Promise(resolve => setTimeout(resolve, 5));
    await history.markSeen("1");
    const state = await history.load();

    expect(state.applied["1"].title).toBe("Backend");
    expect(state.seen["1"]).toBe(before);
  });

  it("markSeen по новой вакансии не делает её откликом", async () => {
    await history.markSeen("2");

    const state = await history.load();

    expect(state.applied["2"]).toBeUndefined();
    expect(state.seen["2"]).toBeTruthy();
  });

  it("повторный markApplied перезаписывает мету", async () => {
    await history.markApplied("1", { title: "old", digestOnly: true });
    await history.markApplied("1", { title: "new", via: "playwright" });

    const state = await history.load();

    expect(state.applied["1"]).toMatchObject({ title: "new", via: "playwright" });
    expect(state.applied["1"].digestOnly).toBeUndefined();
  });
});
