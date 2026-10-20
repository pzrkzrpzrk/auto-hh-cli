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
import type { DigestDoc, DigestEntry } from "@/domain/models.js";
import type {
  DigestArtifactEntry,
  DigestKind,
  DigestRepository,
} from "@/domain/digest/ports.js";

class MongoDigestRepository implements DigestRepository {
  latest(): Promise<DigestDoc | null> {
    return getLatestDigest();
  }

  byDate(date: string): Promise<DigestEntry[]> {
    return getDigestsByDate('digest', date);
  }

  all(): Promise<DigestEntry[]> {
    return getAllDigests('digest');
  }

  listDocs(kind: DigestKind): Promise<DigestDoc[]> {
    return listDigestDocs(kind);
  }

  save(kind: DigestKind, entries: DigestArtifactEntry[], date?: string): Promise<string[]> {
    return kind === 'digest' ? writeDigest(entries, date) : writeRejected(entries, date);
  }

  saveActual(kind: DigestKind, entries: DigestArtifactEntry[], date: string): string | null {
    return kind === 'digest'
      ? writeActualDigest(entries, date)
      : writeActualRejected(entries, date);
  }
}

export default MongoDigestRepository;
