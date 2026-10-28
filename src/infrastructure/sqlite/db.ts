// Менеджер соединения SQLite (встроенный модуль node:sqlite, синхронный драйвер).
// Заменяет infrastructure/mongo/db.ts: файл БД создаётся сам, схема применяется
// при открытии, а WAL сохраняет прогресс поиска при Ctrl+C.
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { ensureDir } from "@/infrastructure/config/paths.js";
import { dbSettings, type DbSettings } from "@/infrastructure/config/db-config.js";
import { applySchema } from "@/infrastructure/sqlite/schema.js";

// Соединение открывается лениво и ровно один раз: путь и PRAGMA приходят из
// dbSettings(), а тесты подставляют своё через connect({ file: ':memory:' }).
// env читается в момент подключения, а не при импорте модуля.
let db: DatabaseSync | null = null;

/**
 * Открыть БД и довести схему до актуальной версии. Идемпотентно: повторный вызов
 * возвращает то же соединение. Синхронно — вызывающие по привычке пишут `await connect()`,
 * и это продолжает работать.
 *
 * overrides — для тестов и диагностики (например, { file: ':memory:' }): значения
 * по умолчанию берутся из dbSettings(), то есть из env в момент первого подключения.
 */
export function connect(overrides: Partial<DbSettings> = {}): DatabaseSync {
  if (db) return db;
  const settings: DbSettings = { ...dbSettings(), ...overrides };
  if (settings.file !== ':memory:') ensureDir(path.dirname(settings.file));
  const conn = new DatabaseSync(settings.file);
  // WAL: обрыв процесса (Ctrl+C) не теряет уже записанные страницы поиска.
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA synchronous = NORMAL');
  // Второй процесс (например, ручной sqlite3) не роняет команду «database is locked».
  conn.exec(`PRAGMA busy_timeout = ${settings.busyTimeoutMs}`);
  conn.exec('PRAGMA foreign_keys = ON');
  applySchema(conn);
  purgeHistory(conn, settings.historyTtlDays);
  db = conn;
  return db;
}

/** Закрыть соединение (CLI вызывает в finally). Повторный вызов безопасен. */
export async function close(): Promise<void> {
  if (!db) return;
  const opened = db;
  db = null;
  try {
    opened.exec('PRAGMA optimize');
  } catch {
    // Оптимизация статистики — не критично, закрываем в любом случае.
  }
  opened.close();
}

/** Выполнить fn в транзакции. Вложенные транзакции не поддерживаются и не нужны. */
export function transaction<T>(fn: () => T): T {
  const conn = connect();
  conn.exec('BEGIN');
  try {
    const result = fn();
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      conn.exec('ROLLBACK');
    } catch {
      // Соединение могло откатиться само — исходную ошибку не перекрываем.
    }
    throw err;
  }
}

/** Фильтр удаления: фрагмент WHERE без ключевого слова и его параметры. */
export interface SqlFilter {
  /** Например: "resume_id = ?" или "kind = ? AND resume_id = ?". */
  where?: string;
  params?: (string | number | null)[];
}

/**
 * Удалить строки таблицы. Имя таблицы подставляет вызывающий (db-janitor),
 * значения — только через параметры.
 */
export function clearTable(table: string, filter: SqlFilter = {}): number {
  const conn = connect();
  const sql = filter.where ? `DELETE FROM ${table} WHERE ${filter.where}` : `DELETE FROM ${table}`;
  const result = conn.prepare(sql).run(...(filter.params ?? []));
  return Number(result.changes ?? 0);
}

/** TTL истории: то же окно, что давал TTL-индекс Mongo (по умолчанию 180 дней). */
function purgeHistory(conn: DatabaseSync, ttlDays: number): void {
  const cutoff = Date.now() - ttlDays * 86_400_000;
  conn.prepare('DELETE FROM history WHERE at < ?').run(cutoff);
}
