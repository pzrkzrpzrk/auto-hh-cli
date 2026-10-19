// Публичная поверхность application-слоя писем.
export { CoverScenario } from "./CoverScenario.js";
export { CoverPipeline } from "./CoverPipeline.js";
export { CoverStage } from "./CoverStage.js";
export type { StageResult } from "./CoverStage.js";
export { CoverPlan, CoverProgress } from "./CoverPlan.js";
export type { CoverMode } from "./CoverMode.js";
export { SingleVacancyMode } from "./SingleVacancyMode.js";
export { DigestCoverMode } from "./DigestCoverMode.js";
export type {
  CoverConfig,
  CoverDeps,
  CoverOutcome,
  OnVacancy,
} from "./CoverDeps.js";
export type { CoverContext, CoverOutcomeKind } from "./CoverContext.js";
