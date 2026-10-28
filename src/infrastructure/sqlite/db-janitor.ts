// Очистка таблиц SQLite: история, дайджесты/rejected и кэш поиска.
// Файлы не трогает — это FileJanitor; вместе их объединяет CompositeDataJanitor.
import { clearTable, type SqlFilter } from "@/infrastructure/sqlite/db.js";
import * as collectCache from "@/infrastructure/sqlite/cache-store.js";
import type { ResetSummary } from "@/domain/ports.js";
import type { ResumeRef } from "@/domain/models.js";
import log from "@/shared/logger.js";

/** Строка сводки: имя таблицы (или артефакта) и число удалённых строк. */
export type DbCleanup = ResetSummary['db'][number];

// name — как таблицу называть в сводке: у digests две «коллекции» (digest и rejected).
function clearSqlTable(table: string, filter: SqlFilter = {}, name = table): DbCleanup {
  try {
    const deleted = clearTable(table, filter);
    if (deleted) log.info(`SQLite ${name}: ${deleted} rows cleared`);
    return { table: name, deleted };
  } catch (err: any) {
    // Молча глотать нельзя: недоступная БД выглядела как успешный сброс.
    log.warn(`SQLite ${name}: не очищено — ${err?.message || err}`);
    return { table: name, deleted: 0 };
  }
}

class DbJanitor {
  /** История, дайджесты и rejected. Кэш поиска — отдельным методом: его чистят не всегда. */
  clearAll(): DbCleanup[] {
    // process.exit() тут быть не должно: иначе `search --reset` убивал бы процесс
    // сразу после очистки кэша — до самого поиска. Закрытие соединения делает CLI.
    return [
      clearSqlTable('history'),
      clearSqlTable('digests', { where: "kind = 'digest'" }, 'digest'),
      clearSqlTable('digests', { where: "kind = 'rejected'" }, 'rejected'),
    ];
  }

  /** Кэш страниц/карточек/вердиктов/писем: строки для сводки. */
  async clearCaches(): Promise<string[]> {
    return collectCache.clear().catch((err: any) => {
      log.warn(`Кэш: не очищен — ${err?.message || err}`);
      return [] as string[];
    });
  }

  /** Данные одного резюме (+ общий кэш поиска по флагу). */
  clearResume(
    resume: ResumeRef,
    opts: { includeSearchCache?: boolean } = {},
  ): { db: DbCleanup[]; cache: string[] } {
    const db = [
      clearSqlTable('digests', { where: 'kind = ? AND resume_id = ?', params: ['digest', resume.id] }, 'digest'),
      clearSqlTable('digests', { where: 'kind = ? AND resume_id = ?', params: ['rejected', resume.id] }, 'rejected'),
      clearSqlTable('cache_judgements', { where: 'resume_id = ?', params: [resume.id] }),
      clearSqlTable('cache_cover_letters', { where: 'resume_id = ?', params: [resume.id] }),
      // Отклики именно этого резюме: без их удаления apply пропустит вакансии как уже обработанные.
      clearSqlTable('history', { where: "json_extract(meta, '$.resumeId') = ?", params: [resume.id] }),
    ];

    const cache: string[] = [];
    if (opts.includeSearchCache) {
      // Общий кэш поиска: search сразу перезапишет его свежей выдачей.
      const pages = clearSqlTable('cache_pages');
      const full = clearSqlTable('cache_full');
      if (pages.deleted) cache.push(`cache_pages: ${pages.deleted}`);
      if (full.deleted) cache.push(`cache_full: ${full.deleted}`);
    }

    return { db, cache };
  }
}

export default DbJanitor;
