// Сводка сброса: печатаются только непустые таблицы и строки кэша.
import { describe, expect, it } from "vitest";
import { formatResetSummary } from "@/application/reset";
import type { ResetSummary } from "@/domain/ports";

const summary = (patch: Partial<ResetSummary> = {}): ResetSummary => ({
  db: [],
  files: [],
  cache: [],
  ...patch,
});

describe("formatResetSummary", () => {
  it("перечисляет непустые таблицы и кэш", () => {
    const text = formatResetSummary(summary({
      db: [{ table: "history", deleted: 3 }, { table: "digest", deleted: 0 }],
      cache: ["cache_pages: 5"],
    }));
    expect(text).toBe("history 3, cache_pages: 5");
  });

  it("пустой сброс — пустая строка", () => {
    expect(formatResetSummary(summary())).toBe("");
  });
});
