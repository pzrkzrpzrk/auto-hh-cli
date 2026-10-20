// Публичная поверхность application-слоя отклика.
export { ApplyScenario } from "@/application/apply/ApplyScenario.js";
export { ApplyPipeline } from "@/application/apply/ApplyPipeline.js";
export { ApplyStage } from "@/application/apply/ApplyStage.js";
export type { StageResult } from "@/application/apply/ApplyStage.js";
export { ApplySummary } from "@/application/apply/ApplySummary.js";
export { ApplicationRunner } from "@/application/apply/ApplicationRunner.js";
export { AllDigestsSelection, LatestDigestSelection, digestSelection } from "@/application/apply/DigestSelection.js";
export type { DigestSelection } from "@/application/apply/DigestSelection.js";
export { AlreadyAppliedRule, MissingLetterRule, SkipRule, applySkipRules } from "@/application/apply/SkipRules.js";
export type { SkipDecision } from "@/application/apply/SkipRules.js";
export { NoPacing, RandomPacing } from "@/application/apply/Pacing.js";
export type { Pacing } from "@/application/apply/Pacing.js";
export type { ApplyDeps, ApplyOutcome, ApplySettings } from "@/application/apply/ApplyDeps.js";
export type { ApplyContext } from "@/application/apply/ApplyContext.js";
