// События сценария дайджеста (Observer): сценарий сообщает о фазах, не зная,
// как их показывать. Консольный вывод подписывается в presentation.
import type { DigestEntry } from "../../domain/models.js";

export type DigestEvent =
  | { type: 'matched'; matched: DigestEntry[] }
  | { type: 'digest-saved'; files: string[]; count: number };

/** Подписчик на события сценария (как SearchReporter: один метод on). */
export interface DigestReporter {
  on(event: DigestEvent): void;
}
