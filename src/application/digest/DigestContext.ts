// Контекст прогона дайджеста: то, что стадии читают и дописывают.
// Один mutable-объект вместо десятка параметров между функциями buildDigest.
import type { DigestEntry, Resume } from "../../domain/models.js";
import type {
  AcceptedCandidate,
  DigestCandidate,
  RejectedEntry,
} from "../../domain/digest/DigestCandidate.js";
import type { DigestPolicy } from "../../domain/digest/DigestPolicy.js";
import type { DigestFilter } from "../../domain/digest/DigestFilter.js";
import type { JudgementSet } from "../../domain/digest/JudgementSet.js";
import type {
  DigestCacheSnapshot,
  DigestConfig,
  DigestRunOptions,
} from "../../domain/digest/types.js";
import type { VacancyListItem } from "../../domain/search/types.js";
import type { VacancySource } from "../../domain/search/VacancySource.js";
import type SearchCache from "../search/SearchCache.js";
import type { DigestDeps } from "./DigestDeps.js";
import type { DigestReporter } from "./DigestEvent.js";

/** Чем закончилась предварительная фаза: ok — конвейер идёт дальше. */
export type DigestOutcome = 'ok' | 'cache-empty' | 'search-empty';

export interface DigestContext {
  readonly deps: DigestDeps;
  readonly opts: DigestRunOptions;
  readonly cfg: DigestConfig;
  readonly policy: DigestPolicy;
  /** Локальный пре-фильтр: правила config.filter + регионы «любые вакансии». */
  readonly filter: DigestFilter;
  readonly resume: Resume | null;
  readonly resumeId?: string;
  readonly source: VacancySource;
  readonly report: DigestReporter;

  /** Стадии заполняют по мере продвижения. */
  cache: SearchCache | null;
  snapshot: DigestCacheSnapshot | null;
  judgements: JudgementSet;
  items: VacancyListItem[];
  candidates: DigestCandidate[];
  accepted: AcceptedCandidate[];
  rejected: RejectedEntry[];
  matched: DigestEntry[];
  judgedCount: number;
  outcome: DigestOutcome;
}
