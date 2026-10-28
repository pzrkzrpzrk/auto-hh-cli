// SQLite-хранилище таблицы resumes: каталог резюме с отпечатком содержимого.
import { connect } from "@/infrastructure/sqlite/db.js";
import { num, nullableText } from "@/infrastructure/sqlite/rows.js";
import { resumeContentHash } from "@/shared/hash.js";
import type { Resume } from "@/domain/models.js";

export interface ResumeDoc {
  resumeId: string;
  name: string;
  filename: string;
  /** sha256 содержимого (текст либо base64 PDF); у legacy-записей отсутствует. */
  contentHash?: string;
  createdAt: Date;
  /** Когда содержимое/имя файла менялись в последний раз. */
  updatedAt?: Date;
}

interface ResumeRow {
  resume_id: unknown;
  name: unknown;
  filename: unknown;
  content_hash: unknown;
  created_at: unknown;
  updated_at: unknown;
}

const SELECT = 'SELECT resume_id, name, filename, content_hash, created_at, updated_at FROM resumes';

function toDoc(row: ResumeRow): ResumeDoc {
  return {
    resumeId: String(row.resume_id),
    name: String(row.name ?? ''),
    filename: String(row.filename ?? ''),
    contentHash: nullableText(row.content_hash) ?? undefined,
    createdAt: new Date(num(row.created_at)),
    updatedAt: row.updated_at == null ? undefined : new Date(num(row.updated_at)),
  };
}

export async function listResumes(): Promise<ResumeDoc[]> {
  const rows = connect().prepare(`${SELECT} ORDER BY created_at DESC`).all() as unknown as ResumeRow[];
  return rows.map(toDoc);
}

export async function findResume(resumeId: string): Promise<ResumeDoc | null> {
  const row = connect().prepare(`${SELECT} WHERE resume_id = ?`).get(resumeId) as unknown as ResumeRow | undefined;
  return row ? toDoc(row) : null;
}

/**
 * Регистрация резюме: обновляет имя/файл/отпечаток, created_at ставит только при вставке.
 * changed=true — содержимое изменилось с прошлой регистрации (вердикты/письма устарели).
 */
export async function registerResume(resume: Resume): Promise<{ created: boolean; changed: boolean }> {
  const db = connect();
  const contentHash = resumeContentHash(resume);
  const existing = db.prepare('SELECT content_hash FROM resumes WHERE resume_id = ?').get(resume.id) as
    { content_hash?: string | null } | undefined;
  const now = Date.now();
  db.prepare(
    `INSERT INTO resumes (resume_id, name, filename, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (resume_id) DO UPDATE SET
       name = excluded.name,
       filename = excluded.filename,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at`,
  ).run(resume.id, resume.name, resume.filename, contentHash, now, now);
  return {
    created: !existing,
    // Legacy-запись без хеша не считается «изменённой»: просто дозаполняем отпечаток.
    changed: Boolean(existing?.content_hash && existing.content_hash !== contentHash),
  };
}
