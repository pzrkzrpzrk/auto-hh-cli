// Сценарий показа дайджеста (Facade): Mongo → письма из кэша; fallback — .md на диске.
// Команда получает готовый исход и только печатает его.
import type { DigestEntry, DigestDoc, ResumeRef } from "@/domain/models.js";
import type { DigestShowDeps } from "@/application/digest/DigestDeps.js";

export type DigestShowOutcome =
  | { kind: 'mongo'; date: string; entries: DigestEntry[]; resumeLabel: string | null }
  | { kind: 'files'; contents: string[] }
  | { kind: 'none' };

export class DigestShowScenario {
  constructor(private readonly deps: DigestShowDeps) {}

  /** opts.resume — показать дайджест конкретного резюме (иначе самый свежий). */
  async run(opts: Record<string, any> = {}): Promise<DigestShowOutcome> {
    const resume = this.resolveResume(opts.resume);
    const digest = await this.deps.digest.latest(resume?.id).catch(() => null);
    if (digest) {
      const entries = await this.deps.coverLetters.attach<DigestEntry>(digest.entries);
      return { kind: 'mongo', date: digest.date, entries, resumeLabel: await this.describeResume(digest, entries) };
    }

    const contents = this.deps.files.latestContents(resume);
    if (!contents.length) return { kind: 'none' };
    return { kind: 'files', contents };
  }

  /** Явно выбранное резюме: ошибка имени не должна валить показ — падаем на «самый свежий». */
  private resolveResume(name?: string): ResumeRef | null {
    if (!name) return null;
    try {
      const resume = this.deps.resumeFiles.load(name);
      return resume ? { name: resume.name, id: resume.id } : null;
    } catch {
      return null;
    }
  }

  /** Заголовок «под каким резюме»: один id → имя из реестра, несколько → «разные резюме». */
  private async describeResume(digest: DigestDoc, entries: DigestEntry[]): Promise<string | null> {
    const ids = new Set<string>();
    if (digest.resumeId) ids.add(digest.resumeId);
    for (const entry of entries) if (entry.resumeId) ids.add(entry.resumeId);
    if (!ids.size) return null;
    if (ids.size > 1) return 'разные резюме';

    const id = [...ids][0];
    try {
      const registered = await this.deps.resumes.find(id);
      if (registered) return `${registered.name} (${registered.filename})`;
    } catch {
      // Mongo недоступна — показываем хотя бы id.
    }
    return digest.resumeName ? `${digest.resumeName} (${id})` : id;
  }
}
