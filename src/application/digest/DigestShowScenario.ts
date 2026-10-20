// Сценарий показа дайджеста (Facade): Mongo → письма из кэша; fallback — .md на диске.
// Команда получает готовый исход и только печатает его.
import type { DigestEntry } from "@/domain/models.js";
import type { DigestShowDeps } from "@/application/digest/DigestDeps.js";

export type DigestShowOutcome =
  | { kind: 'mongo'; date: string; entries: DigestEntry[] }
  | { kind: 'files'; contents: string[] }
  | { kind: 'none' };

export class DigestShowScenario {
  constructor(private readonly deps: DigestShowDeps) {}

  async run(): Promise<DigestShowOutcome> {
    const digest = await this.deps.digest.latest().catch(() => null);
    if (digest) {
      const entries = await this.deps.coverLetters.attach<DigestEntry>(digest.entries);
      return { kind: 'mongo', date: digest.date, entries };
    }

    const contents = this.deps.files.latestContents();
    if (!contents.length) return { kind: 'none' };
    return { kind: 'files', contents };
  }
}
