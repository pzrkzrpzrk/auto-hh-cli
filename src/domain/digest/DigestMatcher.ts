// Domain Service отбора: кто попадает в дайджест, а кто — в rejected.
// Правило не делает I/O и не логирует: факты для логов возвращаются событиями,
// а печатает их стадия (application/digest/stages.ts).
import { fmtSalary } from "../../shared/format.js";
import type {
  AcceptedCandidate,
  DigestCandidate,
  DigestSelection,
  DigestSelectionEvent,
  RejectedEntry,
} from "./DigestCandidate.js";
import type { DigestPolicy } from "./DigestPolicy.js";
import type { JudgementSet } from "./JudgementSet.js";

export class DigestMatcher {
  constructor(private readonly policy: DigestPolicy) {}

  /**
   * Прогоняет кандидатов по порядку, пока не набран лимит `maxRun`.
   * Без вердикта судьи вакансия проходит по шаблону (score=null) — как раньше.
   */
  select(candidates: DigestCandidate[], judgements: JudgementSet): DigestSelection {
    const accepted: AcceptedCandidate[] = [];
    const rejected: RejectedEntry[] = [];
    const events: DigestSelectionEvent[] = [];

    for (const { full, verdict } of candidates) {
      if (accepted.length >= this.policy.maxRun) break;

      let score: number | null = null;
      let reason: string | null = '';
      let comment: string | null = null;

      if (this.policy.useJudge) {
        const judgement = judgements.get(String(full.id));
        if (!judgement) {
          events.push({ kind: 'no-judgement', id: String(full.id) });
        } else {
          score = judgement.score;
          reason = judgement.reason;
          comment = judgement.comment;
          if (!judgement.fit) {
            events.push({ kind: 'rejected', id: String(full.id), score, reason });
            rejected.push({
              id: String(full.id),
              title: full.name,
              employer: full.employer?.name || '—',
              area: full.area?.name || '—',
              salary: fmtSalary(full.salary),
              url: (full.alternate_url as string) || '',
              publishedAt: (full.publishedAt as string | null | undefined) || null,
              score,
              reason,
            });
            continue;
          }
          events.push({ kind: 'approved', id: String(full.id), score, text: comment || reason });
        }
      }

      accepted.push({ full, verdict, score, reason, comment });
    }

    return { accepted, rejected, events };
  }
}
