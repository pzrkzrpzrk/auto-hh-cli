// Публичная поверхность доменного модуля дайджеста: VO, политика и порты.
export { DigestPolicy } from "./DigestPolicy.js";
export type { DigestPolicyContext } from "./DigestPolicy.js";
export { DigestMatcher } from "./DigestMatcher.js";
export { DigestEntryFactory } from "./DigestEntryFactory.js";
export { JudgementSet } from "./JudgementSet.js";
export type { Judgement } from "./JudgementSet.js";
export type {
  AcceptedCandidate,
  CandidateVerdict,
  DigestCandidate,
  DigestSelection,
  RejectedEntry,
} from "./DigestCandidate.js";
export type { DigestCacheSnapshot, DigestConfig, DigestRunOptions } from "./types.js";
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
