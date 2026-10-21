// Адаптер порта DigestRepository поверх digest-store (MongoDB + .md-зеркала).
// Сценарий дайджеста больше не выбирает между writeDigest и writeRejected —
// вид артефакта задаёт DigestKind.
import {
  getDigestsByDate,
  getAllDigests,
  getLatestDigest,
  listDigestDocs,
  writeActualDigest,
  writeActualRejected,
  writeDigest,
  writeRejected,
} from "@/infrastructure/mongo/digest-store.js";
import type { DigestDoc, DigestEntry, ResumeRef } from "@/domain/models.js";
import type {
  DigestArtifactEntry,
  DigestKind,
  DigestRepository,
} from "@/domain/digest/ports.js";

class MongoDigestRepository implements DigestRepository {
  latest(resumeId?: string): Promise<DigestDoc | null> {
    return getLatestDigest(resumeId);
  }

  byDate(date: string, resumeId?: string): Promise<DigestEntry[]> {
    return getDigestsByDate('digest', date, resumeId);
  }

  all(resumeId?: string): Promise<DigestEntry[]> {
    return getAllDigests('digest', resumeId);
  }

  listDocs(kind: DigestKind, resumeId?: string): Promise<DigestDoc[]> {
    return listDigestDocs(kind, resumeId);
  }

  save(
    kind: DigestKind,
    entries: DigestArtifactEntry[],
    date?: string,
    resume?: ResumeRef | null,
  ): Promise<string[]> {
    return kind === 'digest' ? writeDigest(entries, date, resume) : writeRejected(entries, date, resume);
  }

  saveActual(
    kind: DigestKind,
    entries: DigestArtifactEntry[],
    date: string,
    resume?: ResumeRef | null,
  ): string | null {
    return kind === 'digest'
      ? writeActualDigest(entries, date, resume)
      : writeActualRejected(entries, date, resume);
  }
}

export default MongoDigestRepository;
