// Публичная поверхность доменного модуля дайджеста: VO, политика и порты.
export { DigestPolicy } from "./DigestPolicy.js";
export type { DigestPolicyContext } from "./DigestPolicy.js";
export { DigestMatcher } from "./DigestMatcher.js";
export { DigestEntryFactory } from "./DigestEntryFactory.js";
export { DigestFilter } from "./DigestFilter.js";
export { JudgementSet } from "./JudgementSet.js";
export type { Judgement } from "./JudgementSet.js";
export type {
  AcceptedCandidate,
  CandidateVerdict,
  DigestCandidate,
  DigestFilterSelection,
  DigestSelection,
  DigestSelectionEvent,
  RejectedEntry,
  SkippedCandidate,
} from "./DigestCandidate.js";
export type {
  DigestCacheSnapshot,
  DigestConfig,
  DigestFilterRules,
  DigestRunOptions,
} from "./types.js";
export type {
  CoverLetterCache,
  DigestCacheStore,
  DigestFileSource,
  DigestKind,
  DigestRepository,
  JudgementCache,
  ResumeProvider,
  ResumeRegistry,
} from "./ports.js";
