// Политика дайджеста: дефолты, приоритет лимита, включение судьи и dry-run.
import { describe, expect, it } from "vitest";
import { DigestPolicy } from "@/domain/digest/DigestPolicy";
import { DEFAULT_ADAPT_BUDGET } from "@/domain/adapt-resume";

const ctx = { hasResume: true, hasApiKey: true, judgeBatchSize: 10, aiConcurrency: 4 };

describe("DigestPolicy.from", () => {
  it("берёт дефолты, когда конфиг и флаги пустые", () => {
    const p = DigestPolicy.from({}, {}, ctx);
    expect(p.minScore).toBe(7);
    expect(p.maxRun).toBe(50);
    expect(p.dryRun).toBe(false);
    expect(p.useJudge).toBe(true);
    expect(p.adaptResume).toBe(true);
    expect(p.adaptResumeBudget).toBe(DEFAULT_ADAPT_BUDGET);
    expect(p.tracksHistory).toBe(true);
  });

  it("лимит: флаг команды важнее config.apply.maxPerRun, 0 — «из конфига»", () => {
    expect(DigestPolicy.from({ apply: { maxPerRun: 20 } }, { limit: 5 }, ctx).maxRun).toBe(5);
    expect(DigestPolicy.from({ apply: { maxPerRun: 20 } }, {}, ctx).maxRun).toBe(20);
    expect(DigestPolicy.from({ apply: { maxPerRun: 0 } }, { limit: 0 }, ctx).maxRun).toBe(50);
  });

  it("судья выключается без резюме, без ключа и флагом claude: false", () => {
    expect(DigestPolicy.from({}, {}, { ...ctx, hasResume: false }).useJudge).toBe(false);
    expect(DigestPolicy.from({}, {}, { ...ctx, hasApiKey: false }).useJudge).toBe(false);
    expect(DigestPolicy.from({}, { claude: false }, ctx).useJudge).toBe(false);
  });

  it("dry-run: флаг команды важнее конфига и отключает историю", () => {
    expect(DigestPolicy.from({ apply: { dryRun: false } }, { dryRun: true }, ctx).dryRun).toBe(true);
    expect(DigestPolicy.from({ apply: { dryRun: true } }, {}, ctx).dryRun).toBe(true);
    expect(DigestPolicy.from({ apply: { dryRun: true } }, { dryRun: false }, ctx).dryRun).toBe(false);
    expect(DigestPolicy.from({}, { dryRun: true }, ctx).tracksHistory).toBe(false);
  });

  it("бюджет адаптации не опускается ниже 500 символов", () => {
    expect(DigestPolicy.from({ adaptResumeBudget: 100 }, {}, ctx).adaptResumeBudget).toBe(500);
    expect(DigestPolicy.from({ adaptResume: false }, {}, ctx).adaptResume).toBe(false);
  });

  it("размеры пачек не меньше единицы", () => {
    const p = DigestPolicy.from({}, {}, { ...ctx, judgeBatchSize: 0, aiConcurrency: 0 });
    expect(p.judgeBatchSize).toBe(1);
    expect(p.aiConcurrency).toBe(1);
  });
});
