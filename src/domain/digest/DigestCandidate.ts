// Кандидат дайджеста (Value Object): полная карточка + вердикт локального фильтра.
// Раньше это был безымянный объект `{ full, verdict }` из локального фильтра.
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

/** Вакансия, отброшенная локальным фильтром: id, название и причина для лога и истории. */
export interface SkippedCandidate {
  id: string;
  name: string;
  reason?: string;
}

/** Результат локального фильтра: прошедшие кандидаты и пропуски с причинами. */
export interface DigestFilterSelection {
  candidates: DigestCandidate[];
  skipped: SkippedCandidate[];
}

/**
 * Событие отбора для логов стадии: правило не логирует само, а возвращает факты.
 * `reason`/`text` могут быть null — шаблон лога печатает их как раньше.
 */
export type DigestSelectionEvent =
  | { kind: 'no-judgement'; id: string }
  | { kind: 'rejected'; id: string; score: number; reason: string | null }
  | { kind: 'approved'; id: string; score: number; text: string | null };

/** Результат отбора: принятые кандидаты, записи для rejected.md и события для логов. */
export interface DigestSelection {
  accepted: AcceptedCandidate[];
  rejected: RejectedEntry[];
  events: DigestSelectionEvent[];
}
