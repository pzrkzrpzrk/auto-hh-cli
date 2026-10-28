// Хранилище дайджестов и rejected в SQLite (таблица digests).
// Артефакты на диске не изменились: менялась только «документная» часть — вместо
// коллекций Mongo теперь строки таблицы с ключом (kind, date, resume_id).
// Рендер и запись .md вынесены в files/digest-artifacts.ts: формат живёт в одном месте.
import { connect } from "@/infrastructure/sqlite/db.js";
import { fromJson, nullableText, resumeIdFromKey, resumeKey, toJson } from "@/infrastructure/sqlite/rows.js";
import { DigestEntry, DigestDoc, ResumeRef } from "@/domain/models.js";
import { digestDir, rejectedDir } from "@/infrastructure/config/paths.js";
import { writeActualArtifact, writeRegionArtifacts } from "@/infrastructure/files/digest-artifacts.js";
import { dateKey } from "@/shared/time.js";

/** Какой артефакт пишем/читаем: дайджест или отбракованные вакансии. */
export type DigestTable = 'digest' | 'rejected';

interface Row {
  [key: string]: unknown;
}

// Запись дайджеста/rejected привязана к резюме: два резюме за одну дату не перезаписывают друг друга.
async function writeDoc(
  kind: DigestTable,
  entries: any[],
  date = dateKey(),
  resume?: ResumeRef | null,
): Promise<void> {
  if (!entries.length) return;
  connect().prepare(
    `INSERT INTO digests (kind, date, resume_id, resume_name, updated_at, entries)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, date, resume_id) DO UPDATE SET
       resume_name = excluded.resume_name,
       updated_at = excluded.updated_at,
       entries = excluded.entries`,
  ).run(
    kind,
    date,
    resumeKey(resume?.id),
    resume?.name ?? null,
    new Date().toISOString(),
    toJson(entries),
  );
}

// Слияние записей документов: дубли по вакансии (одна и та же вакансия в разных резюме)
// схлопываются, приоритет — у более свежего документа (порядок docs задаёт вызывающий).
function flattenDocs(docs: DigestDoc[]): DigestEntry[] {
  const byId = new Map<string, DigestEntry>();
  for (const doc of docs) {
    for (const entry of doc.entries || []) {
      const id = String(entry.id);
      if (!byId.has(id)) byId.set(id, entry);
    }
  }
  return [...byId.values()];
}

/** Строки дайджеста в форме DigestDoc: JSON-колонка entries разбирается с fallback []. */
function docsOf(rows: Row[]): DigestDoc[] {
  return rows.map(row => ({
    date: String(row.date),
    entries: fromJson<DigestEntry[]>(row.entries, []),
    resumeId: resumeIdFromKey(row.resume_id),
    resumeName: nullableText(row.resume_name),
  }));
}

export async function getDigestsByDate(
  kind: DigestTable,
  date: string,
  resumeId?: string,
): Promise<DigestEntry[]> {
  const db = connect();
  if (resumeId) {
    // Одно резюме — ровно одна запись за дату; если её нет, работаем с legacy-записью
    // (собранной до появления измерения «резюме»), чтобы старые дайджесты не пропадали.
    const own = db
      .prepare('SELECT entries FROM digests WHERE kind = ? AND date = ? AND resume_id = ?')
      .get(kind, date, resumeKey(resumeId)) as Row | undefined;
    if (own) return fromJson<DigestEntry[]>(own.entries, []);
    const legacy = db
      .prepare("SELECT entries FROM digests WHERE kind = ? AND date = ? AND resume_id = ''")
      .get(kind, date) as Row | undefined;
    return fromJson<DigestEntry[]>(legacy?.entries, []);
  }
  // Без резюме — все записи за дату (apply запускается без выбора резюме).
  const rows = db
    .prepare('SELECT date, resume_id, resume_name, entries FROM digests WHERE kind = ? AND date = ? ORDER BY updated_at DESC')
    .all(kind, date) as Row[];
  return flattenDocs(docsOf(rows));
}

// Выводит все дайджесты без отклика (режим apply --type all).
export async function getAllDigests(kind: DigestTable, resumeId?: string): Promise<DigestEntry[]> {
  const db = connect();
  let rows = resumeId
    ? db
      .prepare('SELECT date, resume_id, resume_name, entries FROM digests WHERE kind = ? AND resume_id = ? ORDER BY date DESC, updated_at DESC')
      .all(kind, resumeKey(resumeId)) as Row[]
    : db
      .prepare('SELECT date, resume_id, resume_name, entries FROM digests WHERE kind = ? ORDER BY date DESC, updated_at DESC')
      .all(kind) as Row[];
  if (resumeId && !rows.length) {
    // Нет данных под это резюме — отдаём legacy-записи (как до обновления).
    rows = db
      .prepare("SELECT date, resume_id, resume_name, entries FROM digests WHERE kind = ? AND resume_id = '' ORDER BY date DESC")
      .all(kind) as Row[];
  }
  return flattenDocs(docsOf(rows));
}

// Все записи за все даты — вход шага actualize. Свежие даты сверху.
export async function listDigestDocs(kind: DigestTable, resumeId?: string): Promise<DigestDoc[]> {
  const db = connect();
  const rows = resumeId
    ? db
      .prepare('SELECT date, resume_id, resume_name, entries FROM digests WHERE kind = ? AND resume_id = ? ORDER BY date DESC')
      .all(kind, resumeKey(resumeId)) as Row[]
    : db
      .prepare('SELECT date, resume_id, resume_name, entries FROM digests WHERE kind = ? ORDER BY date DESC')
      .all(kind) as Row[];
  return docsOf(rows).map(doc => ({
    date: doc.date,
    entries: doc.entries,
    resumeId: doc.resumeId ?? null,
    resumeName: doc.resumeName ?? null,
  }));
}

// Последний дайджест — вход шагов cover и apply. null: дайджестов нет.
// Без resumeId — самый свежий документ среди всех резюме (tie-break по updated_at).
export async function getLatestDigest(resumeId?: string): Promise<DigestDoc | null> {
  const db = connect();
  const select = db.prepare(
    `SELECT date, resume_id, resume_name, updated_at, entries FROM digests
     WHERE kind = 'digest' AND resume_id = ? ORDER BY date DESC, updated_at DESC LIMIT 1`,
  );
  const selectAny = db.prepare(
    `SELECT date, resume_id, resume_name, updated_at, entries FROM digests
     WHERE kind = 'digest' ORDER BY date DESC, updated_at DESC LIMIT 1`,
  );

  let row = (resumeId ? select.get(resumeKey(resumeId)) : selectAny.get()) as Row | undefined;
  if (!row && resumeId) {
    // Legacy-дайджест без привязки к резюме: показываем его, пока не пересобран под резюме.
    row = select.get('') as Row | undefined;
  }
  if (!row) return null;
  return {
    date: String(row.date),
    entries: fromJson<DigestEntry[]>(row.entries, []),
    resumeId: resumeIdFromKey(row.resume_id),
    resumeName: nullableText(row.resume_name),
    updatedAt: nullableText(row.updated_at),
  };
}

// date позволяет перезаписать дайджест конкретного дня (используется шагом cover).
// Возвращает пути файлов по регионам (пустой массив — писать нечего).
export async function writeDigest(entries: any[], date = dateKey(), resume?: ResumeRef | null): Promise<string[]> {
  if (!entries.length) return [];
  const files = writeRegionArtifacts(digestDir(resume), entries, date, 'digest.md', 'Дайджест вакансий');
  await writeDoc('digest', entries, date, resume);
  return files;
}

export async function writeRejected(entries: any[], date = dateKey(), resume?: ResumeRef | null): Promise<string[]> {
  if (!entries.length) return [];
  const files = writeRegionArtifacts(rejectedDir(resume), entries, date, 'rejected.md', 'Отклонённые вакансии');
  await writeDoc('rejected', entries, date, resume);
  return files;
}

// Сводный снимок актуальных вакансий дайджеста за дату (все прошлые даты, дедуп — в actualize).
export function writeActualDigest(entries: any[], date = dateKey(), resume?: ResumeRef | null): string | null {
  return writeActualArtifact(digestDir(resume), entries, date, 'Дайджест вакансий (актуальные)');
}

// Сводный снимок актуальных отклонённых вакансий за дату.
export function writeActualRejected(entries: any[], date = dateKey(), resume?: ResumeRef | null): string | null {
  return writeActualArtifact(rejectedDir(resume), entries, date, 'Отклонённые вакансии (актуальные)');
}

