// Адаптер порта JudgementCache: вердикты судьи в таблицу cache_judgements.
import {
  clearJudgementsByResume,
  listJudgementResumeIds,
  saveJudgementsMap,
} from "@/infrastructure/sqlite/cache-store.js";
import type { JudgementCache } from "@/domain/digest/ports.js";
import type { Judgement } from "@/domain/digest/JudgementSet.js";

class SqliteJudgementCache implements JudgementCache {
  save(judgements: Record<string, Judgement>, resumeId?: string, date?: Date): Promise<void> {
    return saveJudgementsMap(judgements, resumeId, date);
  }

  listResumeIds(): Promise<string[]> {
    return listJudgementResumeIds();
  }

  clearResume(resumeId: string): Promise<number> {
    return clearJudgementsByResume(resumeId);
  }
}

export default SqliteJudgementCache;
