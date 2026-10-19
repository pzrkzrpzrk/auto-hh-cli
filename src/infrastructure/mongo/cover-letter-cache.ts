// Адаптер порта CoverLetterCache: письма из cacheCoverLetters подклеиваются к записям.
import { withCoverLetters } from "./cache-store.js";
import type { CoverLetterCache } from "../../domain/digest/ports.js";

class MongoCoverLetterCache implements CoverLetterCache {
  attach<T extends { id: string | number; coverLetter?: string }>(entries: T[]): Promise<T[]> {
    return withCoverLetters(entries);
  }
}

export default MongoCoverLetterCache;
