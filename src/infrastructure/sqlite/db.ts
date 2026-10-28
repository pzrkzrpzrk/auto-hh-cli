// Менеджер соединения SQLite (встроенный модуль node:sqlite, синхронный драйвер).
// Заменяет infrastructure/mongo/db.ts: файл БД создаётся сам, схема применяется
// при открытии, а WAL сохраняет прогресс поиска при Ctrl+C.
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { ensureDir, DATA_DIR } from "@/infrastructure/config/paths.js";
import { intFromEnv } from "@/infrastructure/config/env.js";
import { applySchema } from "@/infrastructure/sqlite/schema.js";

// Путь к файлу БД: SQLITE_PATH перебивает значение по умолчанию (data/ уже в .gitignore).
// Относительный путь считается от корня проекта, а не от cwd: команду можно запускать
// из любой папки. ':memory:' поддерживается — так адаптеры проверяются без файла на диске.
const DB_PATH = resolveDbPath();

function resolveDbPath(): string {
  const configured = process.env.SQLITE_PATH;
  if (!configured) return path.join(DATA_DIR, 'autohh.db');
  if (configured === ':memory:') return configured;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(path.dirname(DATA_DIR), configured);
}

// В Mongo история просмотров жила с TTL 180 дней — здесь чистим разово при открытии.
const HISTORY_TTL_DAYS = 180;

let db: DatabaseSync | null = null;

/** Файл, к которому подключены (для логов и диагностики). */
export function dbFile(): string {
  return DB_PATH;
}

/**
 * Открыть БД и довести схему до актуальной версии. Идемпотентно: повторный вызов
 * возвращает то же соединение. Синхронно — вызывающие по привычке пишут `await connect()`,
 * и это продолжает работать.
 */
export function connect(): DatabaseSync {
  if (db) return db;
  if (DB_PATH !== ':memory:') ensureDir(path.dirname(DB_PATH));
  const opened = new DatabaseSync(DB_PATH);
  // WAL: обрыв процесса (Ctrl+C) не теряет уже записанные страницы поиска.
  opened.exec('PRAGMA journal_mode = WAL');
  opened.exec('PRAGMA synchronous = NORMAL');
  // Второй процесс (например, ручной sqlite3) не роняет команду «database is locked».
  opened.exec(`PRAGMA busy_timeout = ${intFromEnv('SQLITE_BUSY_TIMEOUT_MS', 5000, { min: 0 })}`);
  opened.exec('PRAGMA foreign_keys = ON');
  applySchema(opened);
  purgeHistory(opened);
  db = opened;
  return db;
}

export function dbInstance(): DatabaseSync {
  if (!db) throw new Error('SQLite not connected. Call connect() first.');
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

/** TTL истории: то же окно (180 дней), что давал TTL-индекс Mongo. */
function purgeHistory(conn: DatabaseSync): void {
  const cutoff = Date.now() - HISTORY_TTL_DAYS * 86_400_000;
  conn.prepare('DELETE FROM history WHERE at < ?').run(cutoff);
}
