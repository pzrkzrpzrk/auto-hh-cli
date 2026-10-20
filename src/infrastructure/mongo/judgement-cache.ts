// Адаптер порта JudgementCache: вердикты судьи в коллекцию cacheJudgements.
import { saveJudgementsMap } from "./cache-store.js";
import type { JudgementCache } from "../../domain/digest/ports.js";
import type { Judgement } from "../../domain/digest/JudgementSet.js";

class MongoJudgementCache implements JudgementCache {
  save(judgements: Record<string, Judgement>, resumeId?: string, date?: Date): Promise<void> {
    return saveJudgementsMap(judgements, resumeId, date);
  }
}

export default MongoJudgementCache;
