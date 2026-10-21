// Совместимый фасад шага digest: сборка, показ и актуализация.
// Оркестрация — в application/digest/* (конвейер и сценарии); здесь только точки входа,
// которые использует команда и внешние импорты.
import type { DigestEntry } from "@/domain/models.js";
import { DigestScenario } from "@/application/digest/DigestScenario.js";
import type { DigestBuildResult } from "@/application/digest/DigestScenario.js";
import { DigestShowScenario } from "@/application/digest/DigestShowScenario.js";
import type { DigestShowOutcome } from "@/application/digest/DigestShowScenario.js";
import { ActualizeScenario } from "@/application/digest/ActualizeScenario.js";
import type { ActualizeResult } from "@/application/digest/ActualizeScenario.js";
import type { ActualizeDeps, DigestDeps, DigestShowDeps } from "@/application/digest/DigestDeps.js";

// Совместимость: команда и composition root импортируют типы из этого модуля.
export type { ActualizeDeps, DigestDeps, DigestShowDeps } from "@/application/digest/DigestDeps.js";
export type { DigestBuildResult } from "@/application/digest/DigestScenario.js";
export type { DigestShowOutcome } from "@/application/digest/DigestShowScenario.js";
export type { ActualizeResult } from "@/application/digest/ActualizeScenario.js";

/**
 * Шаг digest: совместимая обёртка над сценарием (application/digest/DigestScenario.ts).
 * null — собирать нечего (пустой кэш или пустая выдача). onMatched используется для печати топа.
 */
export async function buildDigest(
  opts: Record<string, any> = {},
  deps: DigestDeps,
  onMatched?: (matched: DigestEntry[]) => void,
): Promise<DigestBuildResult | null> {
  const scenario = new DigestScenario(deps, {
    on: event => {
      if (event.type === 'matched' && onMatched) onMatched(event.matched);
    },
  });
  return scenario.build(opts);
}

/** Шаг актуализации: обновляет старые дайджесты и rejected по последней выдаче. */
export async function actualizeDigests(
  opts: Record<string, any> = {},
  deps: ActualizeDeps,
): Promise<ActualizeResult | null> {
  return new ActualizeScenario(deps).run(opts);
}

/** Шаг показа: последний дайджест + письма; fallback — .md-файлы на диске. */
export async function showDigest(deps: DigestShowDeps, opts: Record<string, any> = {}): Promise<DigestShowOutcome> {
  return new DigestShowScenario(deps).run(opts);
}

