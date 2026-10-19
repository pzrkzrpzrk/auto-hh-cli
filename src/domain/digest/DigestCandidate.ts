// Кандидат дайджеста (Value Object): полная карточка + вердикт локального фильтра.
// Раньше это был безымянный объект `{ full, verdict }` из selectCandidates.
import type { DigestEntry, Vacancy } from "../models.js";

/** Вердикт локального фильтра: ok=false несёт причину для лога и истории. */
export interface CandidateVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Запись rejected.md: те же поля, что у DigestEntry, но без письма и комментария —
 * судья их не заполняет, а .md-рендер выводит только присутствующие поля.
 */
export type RejectedEntry = Omit<DigestEntry, 'comment' | 'coverLetter'>;

export interface DigestCandidate {
  readonly full: Vacancy;
  readonly verdict: CandidateVerdict;
}

/** Кандидат, прошедший отбор: к вердикту добавлена оценка судьи (null — судьи не было). */
export interface AcceptedCandidate extends DigestCandidate {
  readonly score: number | null;
  readonly reason: string | null;
  readonly comment: string | null;
}

/** Результат отбора: принятые кандидаты и готовые записи для rejected.md. */
export interface DigestSelection {
  accepted: AcceptedCandidate[];
  rejected: RejectedEntry[];
}
