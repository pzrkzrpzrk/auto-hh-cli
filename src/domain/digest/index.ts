// Публичная поверхность доменного модуля дайджеста: VO, политика и порты.
export { DigestPolicy } from "@/domain/digest/DigestPolicy.js";
export type { DigestPolicyContext } from "@/domain/digest/DigestPolicy.js";
export { DigestMatcher } from "@/domain/digest/DigestMatcher.js";
export { DigestEntryFactory } from "@/domain/digest/DigestEntryFactory.js";
export { DigestFilter } from "@/domain/digest/DigestFilter.js";
export { JudgementSet } from "@/domain/digest/JudgementSet.js";
export type { Judgement } from "@/domain/digest/JudgementSet.js";
export type {
  AcceptedCandidate,
  CandidateVerdict,
  DigestCandidate,
  DigestFilterSelection,
  DigestSelection,
  DigestSelectionEvent,
  RejectedEntry,
  SkippedCandidate,
} from "@/domain/digest/DigestCandidate.js";
export type {
  DigestCacheSnapshot,
  DigestConfig,
  DigestFilterRules,
  DigestRunOptions,
} from "@/domain/digest/types.js";
export type {
  CoverLetterCache,
  DigestCacheStore,
  DigestFileSource,
  DigestKind,
  DigestRepository,
  JudgementCache,
  ResumeProvider,
  ResumeRegistry,
} from "@/domain/digest/ports.js";
