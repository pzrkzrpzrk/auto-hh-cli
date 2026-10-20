// Адаптер порта CoverLetterCache: письма из cacheCoverLetters — чтение (с force) и запись.
import { saveLetter, withCoverLetters } from "@/infrastructure/mongo/cache-store.js";
import type { CoverLetterCache } from "@/domain/digest/ports.js";

class MongoCoverLetterCache implements CoverLetterCache {
  attach<T extends { id: string | number; coverLetter?: string }>(
    entries: T[],
    opts: { force?: boolean } = {},
  ): Promise<T[]> {
    return withCoverLetters(entries, opts);
  }

  save(vacancyId: string | number, letter: string): Promise<void> {
    return saveLetter(String(vacancyId), letter);
  }
}

export default MongoCoverLetterCache;
