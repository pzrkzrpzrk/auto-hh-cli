// Адаптер порта JudgementCache: вердикты судьи в коллекцию cacheJudgements.
import { saveJudgementsMap } from "./cache-store.js";
import type { JudgementCache } from "../../domain/digest/ports.js";

class MongoJudgementCache implements JudgementCache {
  save(judgements: Record<string, any>, resumeId?: string, date?: Date): Promise<void> {
    return saveJudgementsMap(judgements, resumeId, date);
  }
}

export default MongoJudgementCache;
