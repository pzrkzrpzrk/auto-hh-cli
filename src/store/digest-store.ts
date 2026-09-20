import fs from "fs";
import path from "path";
import { connect, dbInstance } from "../clients/db";
import { DigestEntry, DigestDoc } from "../types";

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function dateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function toMarkdown(entries: any[], title: string, date = dateKey()): string {
  const lines: string[] = [`# ${title} — ${date} (${entries.length} вакансий)\n`];
  for (const e of entries) {
    lines.push(`---`);
    lines.push(`**${e.title || '—'}** @ ${e.employer || '—'}`);
    lines.push(`- Регион: ${e.area || '—'}`);
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

// Последний дайджест — вход шагов cover и apply. null: MongoDB недоступна или дайджестов нет.
export async function getLatestDigest(): Promise<DigestDoc | null> {
  await connect();
  const docs = await dbInstance().collection<DigestDoc>('digest')
    .find({}, { projection: { date: 1, entries: 1 }, sort: { date: -1 }, limit: 1 })
    .toArray();
  if (!docs.length) return null;
  return { date: docs[0].date, entries: docs[0].entries || [] };
}

// date позволяет перезаписать дайджест конкретного дня (используется шагом cover).
export async function writeDigest(entries: any[], date = dateKey()): Promise<string | null> {
  if (!entries.length) return null;
  ensureDir();
  const md = path.join(DATA_DIR, `digest-${date}.md`);
  fs.writeFileSync(md, toMarkdown(entries, 'Дайджест вакансий', date));
  await writeToMongo('digest', entries, date);
  return md;
}

export async function writeRejected(entries: any[], date = dateKey()): Promise<string | null> {
  if (!entries.length) return null;
  ensureDir();
  const md = path.join(DATA_DIR, `rejected-${date}.md`);
  fs.writeFileSync(md, toMarkdown(entries, 'Отклонённые вакансии', date));
  await writeToMongo('rejected', entries, date);
  return md;
}
