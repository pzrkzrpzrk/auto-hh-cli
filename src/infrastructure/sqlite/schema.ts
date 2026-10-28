// Схема SQLite и её версия (PRAGMA user_version).
// Заменяет migrations/ + migrate-mongo: шаги применяются один раз при connect(),
// поэтому отдельная команда `npm run migrate:up` больше не нужна.
import type { DatabaseSync } from "node:sqlite";

/**
 * Шаги миграций: индекс в массиве = версия схемы после применения.
 * Применённые шаги не редактируются — новое изменение добавляется в конец.
 */
const MIGRATIONS: readonly string[] = [
  // v1 — начальная схема: таблицы вместо коллекций MongoDB.
  `
  -- Страницы выдачи: page хранится строкой ('0', '1', 'remote:2').
  CREATE TABLE IF NOT EXISTS cache_pages (
    date TEXT NOT NULL,
    page TEXT NOT NULL,
    items TEXT NOT NULL,
    PRIMARY KEY (date, page)
  );

  -- Полные карточки вакансий: общий кэш, от резюме не зависит.
  CREATE TABLE IF NOT EXISTS cache_full (
    vacancy_id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    full TEXT NOT NULL
  );

  -- Вердикты судьи: date + резюме + вакансия ('' — резюме не выбрано).
  CREATE TABLE IF NOT EXISTS cache_judgements (
    date TEXT NOT NULL,
    resume_id TEXT NOT NULL DEFAULT '',
    vacancy_id TEXT NOT NULL,
    score REAL,
    fit INTEGER,
    reason TEXT,
    comment TEXT,
    PRIMARY KEY (date, resume_id, vacancy_id)
  );

  -- Сопроводительные письма: одно письмо на вакансию для каждого резюме.
  CREATE TABLE IF NOT EXISTS cache_cover_letters (
    resume_id TEXT NOT NULL DEFAULT '',
    vacancy_id TEXT NOT NULL,
    date TEXT NOT NULL,
    letter TEXT NOT NULL,
    PRIMARY KEY (resume_id, vacancy_id)
  );

  -- История откликов и просмотров. at — epoch-ms: так проще сравнивать с TTL.
  CREATE TABLE IF NOT EXISTS history (
    vacancy_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('seen', 'applied')),
    at INTEGER NOT NULL,
    meta TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_history_at ON history (at);
  CREATE INDEX IF NOT EXISTS idx_history_status ON history (status);

  -- Дайджесты и rejected одной таблицей: kind различает артефакт,
  -- ключ (kind, date, resume) повторяет уникальность Mongo-коллекций.
  CREATE TABLE IF NOT EXISTS digests (
    kind TEXT NOT NULL CHECK (kind IN ('digest', 'rejected')),
    date TEXT NOT NULL,
    resume_id TEXT NOT NULL DEFAULT '',
    resume_name TEXT,
    updated_at TEXT NOT NULL,
    entries TEXT NOT NULL,
    PRIMARY KEY (kind, date, resume_id)
  );

  -- Реестр резюме: имя, файл и отпечаток содержимого (текст резюме тут не хранится).
  CREATE TABLE IF NOT EXISTS resumes (
    resume_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  );
  `,
];

/** Ожидаемая версия схемы — для диагностики (в CLI не требуется). */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Доводит схему до SCHEMA_VERSION. Идемпотентно: при повторном вызове шагов нет.
 * Каждый шаг в транзакции: если DDL упал, user_version не «уедет» вперёд.
 */
export function applySchema(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number | bigint } | undefined;
  const current = Number(row?.user_version ?? 0);
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Откат мог уже случиться сам — исходную ошибку не перекрываем.
      }
      throw err;
    }
  }
}
