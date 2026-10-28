// Адаптер порта DataJanitor: файлы data/ + таблицы SQLite.
// Порт один (сценарию нужен «сброс данных»), ответственности разделены:
// FileJanitor чистит диск, DbJanitor — базу, этот класс собирает сводку.
import FileJanitor from "@/infrastructure/files/file-janitor.js";
import DbJanitor from "@/infrastructure/sqlite/db-janitor.js";
import type { DataJanitor, ResetSummary } from "@/domain/ports.js";
import type { ResumeRef } from "@/domain/models.js";
import log from "@/shared/logger.js";

class CompositeDataJanitor implements DataJanitor {
  constructor(
    private readonly files: FileJanitor = new FileJanitor(),
    private readonly db: DbJanitor = new DbJanitor(),
  ) {}

  async clearAll(): Promise<ResetSummary> {
    const files = this.files.clearAll();
    const db = this.db.clearAll();
    const cache = await this.db.clearCaches();
    cache.forEach(p => log.info(`Removed ${p}`));
    return { db, files, cache };
  }

  /** Сброс одного резюме: его артефакты, дайджесты, вердикты, письма и отклики. */
  async clearResume(resume: ResumeRef, opts: { includeSearchCache?: boolean } = {}): Promise<ResetSummary> {
    const files = this.files.clearResume(resume);
    const { db, cache } = this.db.clearResume(resume, opts);
    return { db, files, cache };
  }
}

export default CompositeDataJanitor;
