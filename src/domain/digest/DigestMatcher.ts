// Domain Service отбора: кто попадает в дайджест, а кто — в rejected.
// Раньше это была функция selectAccepted в application/digest.ts: правило отбора,
// логи и break по лимиту были перемешаны. Теперь правило читает политику и не делает I/O.
import type { Logger } from "../logging.js";
import { fmtSalary } from "../../shared/format.js";
import type { AcceptedCandidate, DigestCandidate, DigestSelection, RejectedEntry } from "./DigestCandidate.js";
import type { DigestPolicy } from "./DigestPolicy.js";
import type { JudgementSet } from "./JudgementSet.js";

export class DigestMatcher {
  constructor(
    private readonly policy: DigestPolicy,
    private readonly logger?: Logger,
  ) {}

  /**
   * Прогоняет кандидатов по порядку, пока не набран лимит `maxRun`.
   * Без вердикта судьи вакансия проходит по шаблону (score=null) — как раньше.
   */
  select(candidates: DigestCandidate[], judgements: JudgementSet): DigestSelection {
    const accepted: AcceptedCandidate[] = [];
    const rejected: RejectedEntry[] = [];

    for (const { full, verdict } of candidates) {
      if (accepted.length >= this.policy.maxRun) break;

      let score: number | null = null;
      let reason = '';
      let comment: string | null = null;

      if (this.policy.useJudge) {
        const judgement = judgements.get(String(full.id));
        if (!judgement) {
          this.logger?.warn(`No judgement for ${full.id}, falling back to template`);
        } else {
          score = judgement.score;
          reason = judgement.reason;
          comment = judgement.comment;
          if (!judgement.fit) {
            this.logger?.info(`Claude rejected ${full.id} (score=${score}): ${reason}`);
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
          this.logger?.info(`Claude approved ${full.id} (score=${score}): ${comment || reason}`);
        }
      }

      accepted.push({ full, verdict, score, reason, comment });
    }

    return { accepted, rejected };
  }
}
