// Domain Service сборки записей дайджеста (Factory): кандидат + вердикт → DigestEntry.
// Заменяет функцию buildResults из application/digest.ts: маппинг и отметка истории
// в одном месте, формат полей остаётся прежним.
import log from "../../shared/logger.js";
import { fmtSalary } from "../../shared/format.js";
import type { DigestEntry } from "../models.js";
import type { HistoryStore } from "../ports.js";
import type { AcceptedCandidate } from "./DigestCandidate.js";

export class DigestEntryFactory {
  constructor(private readonly history: HistoryStore) {}

  /**
   * Собирает записи для digest.md. `track=false` (dry-run) не трогает историю откликов.
   * Побочный эффект — `markApplied` с digestOnly: шаг apply отличает такую отметку
   * от реального отклика и не пропускает вакансию.
   */
  async create(accepted: AcceptedCandidate[], track = true): Promise<DigestEntry[]> {
    const matched: DigestEntry[] = [];

    for (const { full, score, reason, comment } of accepted) {
      matched.push({
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
      });

      if (track) {
        await this.history.markApplied(String(full.id), {
          title: full.name,
          employer: full.employer?.name,
          url: full.alternate_url,
          score,
          digestOnly: true,
        });
      }
      log.info(`Match: ${full.name} @ ${full.employer?.name} -> ${full.alternate_url}`);
    }

    return matched;
  }
}
