// Domain Service сборки записей дайджеста (Factory): кандидат + вердикт → DigestEntry.
// Только маппинг: отметку истории и логи делает стадия SelectStage.
import { fmtSalary } from "@/shared/format.js";
import type { DigestEntry } from "@/domain/models.js";
import type { AcceptedCandidate } from "@/domain/digest/DigestCandidate.js";

export class DigestEntryFactory {
  /** Собирает записи для digest.md. Побочных эффектов нет — их выполняет стадия. */
  create(accepted: AcceptedCandidate[]): DigestEntry[] {
    return accepted.map(({ full, score, reason, comment }) => ({
      id: String(full.id),
      title: full.name,
      employer: full.employer?.name || '—',
      area: full.area?.name || '—',
      salary: fmtSalary(full.salary),
      url: (full.alternate_url as string) || '',
      publishedAt: (full.publishedAt as string | null | undefined) || null,
      score,
      reason,
      comment,
      coverLetter: '',
    }));
  }
}
