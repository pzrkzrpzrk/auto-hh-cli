// Адаптер порта CoverLetterCache: письма из cacheCoverLetters — чтение (с force/резюме) и запись.
import {
  clearLettersByResume,
  listLetterResumeIds,
  saveLetter,
  withCoverLetters,
} from "@/infrastructure/mongo/cache-store.js";
import type { CoverLetterCache } from "@/domain/digest/ports.js";

class MongoCoverLetterCache implements CoverLetterCache {
  attach<T extends { id: string | number; coverLetter?: string; coverLetterResumeId?: string | null }>(
    entries: T[],
    opts: { force?: boolean; resumeId?: string } = {},
  ): Promise<T[]> {
    return withCoverLetters(entries, opts);
  }

  save(vacancyId: string | number, letter: string, resumeId?: string): Promise<void> {
    return saveLetter(String(vacancyId), letter, resumeId);
  }

  listResumeIds(): Promise<string[]> {
    return listLetterResumeIds();
  }

  clearResume(resumeId: string): Promise<number> {
    return clearLettersByResume(resumeId);
  }
}

export default MongoCoverLetterCache;
