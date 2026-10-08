import fs from "fs";
import path from "path";
import { connect, dbInstance } from "../clients/db.js";
import { DigestEntry, DigestDoc } from "../types.js";
import { DIGEST_DIR, REJECTED_DIR, UNKNOWN_REGION, ensureDir, regionDir } from "../paths.js";
import { dateKey } from "../time.js";

function toMarkdown(entries: any[], title: string, date = dateKey()): string {
  const gone = entries.filter(e => e.archived).length;
  const countNote = gone ? `${entries.length} вакансий, недоступно ${gone}` : `${entries.length} вакансий`;
  const lines: string[] = [`# ${title} — ${date} (${countNote})\n`];
  // Архивные записи (шаг actualize) уводим в конец: живые вакансии остаются сверху.
  const ordered = gone
    ? [...entries].sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)))
    : entries;
  for (const e of ordered) {
    lines.push(`---`);
    lines.push(`**${e.title || '—'}** @ ${e.employer || '—'}`);
    lines.push(`- Регион: ${e.area || '—'}`);
    if (e.archived) lines.push(`- Статус: больше не в поиске${e.checkedAt ? ` (проверено ${e.checkedAt})` : ''}`);
    lines.push(`- Зарплата: ${e.salary || '—'}`);
    if (e.publishedAt) lines.push(`- Опубликована: ${String(e.publishedAt).slice(0, 10)}`);
    if (e.score != null) lines.push(`- Оценка: ${e.score}/10`);
    if (e.reason) lines.push(`- Причина: ${e.reason}`);
    if (e.comment) lines.push(`- Совпадение: ${e.comment}`);
    if (e.url) lines.push(`- Ссылка: ${e.url}`);
    if (e.coverLetter) {
      lines.push(`\n**Сопроводительное:**\n\n${e.coverLetter}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function writeToMongo(collection: string, entries: any[], date = dateKey()): Promise<void> {
  if (!entries.length) return;
  await connect();
  await dbInstance().collection(collection).updateOne(
    { date },
    { $set: { date, entries } },
    { upsert: true },
  );
}

export async function getDigestsByDate(collection: string, date: string): Promise<DigestEntry[]> {
  await connect();
  const doc = await dbInstance().collection<DigestDoc>(collection).findOne({ date }, { projection: { entries: 1 } });
  return doc?.entries || [];
}

// выводит все дайджесты без отклика
export async function getAllDigests(collection: string): Promise<DigestEntry[]> {
  await connect();
  const docs = await dbInstance().collection<DigestDoc>(collection).find({}, { projection: { entries: 1 }, sort: { date: -1 } }).toArray();
  return docs.flatMap(d => d.entries || []);
}

// Все документы коллекции с датами — вход шага actualize. Свежие даты сверху.
export async function listDigestDocs(collection: string): Promise<DigestDoc[]> {
  await connect();
  const docs = await dbInstance().collection<DigestDoc>(collection)
    .find({}, { projection: { date: 1, entries: 1 }, sort: { date: -1 } })
    .toArray();
  return docs.map(d => ({ date: d.date, entries: d.entries || [] }));
}

// Последний дайджест — вход шагов cover и apply. null: MongoDB недоступна или дайджестов нет.
export async function getLatestDigest(): Promise<DigestDoc | null> {
  await connect();
  const docs = await dbInstance().collection<DigestDoc>('digest')
    .find({}, { projection: { date: 1, entries: 1 }, sort: { date: -1 }, limit: 1 })
    .toArray();
  if (!docs.length) return null;
  return { date: docs[0].date, entries: docs[0].entries || [] };
}

// Регион вакансии — имя папки. Плейсхолдер '—' (area не пришёл) — как «Не указан».
function regionOf(entry: any): string {
  const area = entry?.area;
  return !area || area === '—' ? UNKNOWN_REGION : String(area);
}

// Группировка записей по региону с сохранением порядка появления.
function groupByArea(entries: any[]): Map<string, any[]> {
  const groups = new Map<string, any[]>();
  for (const e of entries) {
    const key = regionOf(e);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }
  return groups;
}

// Пишет по файлу на регион: <baseDir>/<date>/<region>/<fileName>. Возвращает пути файлов.
function writeArtifacts(baseDir: string, entries: any[], date: string, fileName: string, titlePrefix: string): string[] {
  const files: string[] = [];
  for (const [region, group] of groupByArea(entries)) {
    const dir = regionDir(baseDir, date, region);
    ensureDir(dir);
    const md = path.join(dir, fileName);
    fs.writeFileSync(md, toMarkdown(group, `${titlePrefix} — ${region}`, date));
    files.push(md);
  }
  return files;
}

// date позволяет перезаписать дайджест конкретного дня (используется шагом cover).
// Возвращает пути файлов по регионам (пустой массив — писать нечего).
export async function writeDigest(entries: any[], date = dateKey()): Promise<string[]> {
  if (!entries.length) return [];
  const files = writeArtifacts(DIGEST_DIR, entries, date, 'digest.md', 'Дайджест вакансий');
  await writeToMongo('digest', entries, date);
  return files;
}

export async function writeRejected(entries: any[], date = dateKey()): Promise<string[]> {
  if (!entries.length) return [];
  const files = writeArtifacts(REJECTED_DIR, entries, date, 'rejected.md', 'Отклонённые вакансии');
  await writeToMongo('rejected', entries, date);
  return files;
}

// Сводный снимок актуализации: один файл на дату, без разбивки по регионам.
// Пишется шагом `digest actualize` в <baseDir>/<date>/actual.md и собирает записи
// всех прошедших дат. Пустой список — файла нет.
function writeActualFile(baseDir: string, entries: any[], date: string, title: string): string | null {
  if (!entries.length) return null;
  const dir = path.join(baseDir, date);
  ensureDir(dir);
  const md = path.join(dir, 'actual.md');
  fs.writeFileSync(md, toMarkdown(entries, title, date));
  return md;
}

// Сводный снимок актуальных вакансий дайджеста за дату (все прошлые даты, дедуп — в actualize).
export function writeActualDigest(entries: any[], date = dateKey()): string | null {
  return writeActualFile(DIGEST_DIR, entries, date, 'Дайджест вакансий (актуальные)');
}

// Сводный снимок актуальных отклонённых вакансий за дату.
export function writeActualRejected(entries: any[], date = dateKey()): string | null {
  return writeActualFile(REJECTED_DIR, entries, date, 'Отклонённые вакансии (актуальные)');
}
