// Публичная поверхность application-слоя писем.
export { CoverScenario } from "@/application/cover/CoverScenario.js";
export { CoverPipeline } from "@/application/cover/CoverPipeline.js";
export { CoverStage } from "@/application/cover/CoverStage.js";
export type { StageResult } from "@/application/cover/CoverStage.js";
export { CoverPlan, CoverProgress } from "@/application/cover/CoverPlan.js";
export type { CoverMode } from "@/application/cover/CoverMode.js";
export { SingleVacancyMode } from "@/application/cover/SingleVacancyMode.js";
export { DigestCoverMode } from "@/application/cover/DigestCoverMode.js";
export type {
  CoverConfig,
  CoverDeps,
  CoverOutcome,
  OnVacancy,
} from "@/application/cover/CoverDeps.js";
export type { CoverContext, CoverOutcomeKind } from "@/application/cover/CoverContext.js";
