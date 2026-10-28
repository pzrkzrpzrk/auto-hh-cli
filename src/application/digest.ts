// Совместимый фасад шага digest: сборка, показ и актуализация.
// Оркестрация — в application/digest/* (конвейер и сценарии); здесь только точки входа,
// которые использует команда и внешние импорты.
import type { DigestEntry } from "@/domain/models.js";
import type { DigestRunOptions } from "@/domain/digest/types.js";
import type { ActualizeOptions, ShowOptions } from "@/application/options.js";
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
// DTO для печати: presentation не импортирует domain напрямую (правило depcruise).
export type { DigestEntry } from "@/domain/models.js";
// Флаги сборки дайджеста — тип домена, реэкспорт для CLI и меню.
export type { DigestRunOptions } from "@/domain/digest/types.js";

/**
 * Шаг digest: совместимая обёртка над сценарием (application/digest/DigestScenario.ts).
 * null — собирать нечего (пустой кэш или пустая выдача). onMatched используется для печати топа.
 */
export async function buildDigest(
  opts: DigestRunOptions = {},
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
  opts: ActualizeOptions = {},
  deps: ActualizeDeps,
): Promise<ActualizeResult | null> {
  return new ActualizeScenario(deps).run(opts);
}

/** Шаг показа: последний дайджест + письма; fallback — .md-файлы на диске. */
export async function showDigest(deps: DigestShowDeps, opts: ShowOptions = {}): Promise<DigestShowOutcome> {
  return new DigestShowScenario(deps).run(opts);
}

