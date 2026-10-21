import fs from "fs";
import path from "path";
import { connect, dbInstance } from "@/infrastructure/mongo/db.js";
import { DigestEntry, DigestDoc, ResumeRef } from "@/domain/models.js";
import { digestDir, rejectedDir, UNKNOWN_REGION, ensureDir, regionDir } from "@/infrastructure/config/paths.js";
import { dateKey } from "@/shared/time.js";

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

// Документ дайджеста/rejected привязан к резюме: два резюме за одну дату не перезаписывают друг друга.
async function writeToMongo(
  collection: string,
  entries: any[],
  date = dateKey(),
  resume?: ResumeRef | null,
): Promise<void> {
  if (!entries.length) return;
  await connect();
  const resumeId = resume?.id ?? null;
  await dbInstance().collection(collection).updateOne(
    { date, resumeId },
    {
      $set: {
        date,
        resumeId,
        resumeName: resume?.name ?? null,
        updatedAt: new Date().toISOString(),
        entries,
      },
    },
    { upsert: true },
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

export async function getDigestsByDate(collection: string, date: string, resumeId?: string): Promise<DigestEntry[]> {
  await connect();
  const filter: any = { date };
  if (resumeId) filter.resumeId = resumeId;
  if (resumeId) {
    // Одно резюме — ровно один документ за дату; если его нет, работаем с legacy-документом
    // (собранным до появления измерения «резюме»), чтобы старые дайджесты не пропадали.
    const own = await dbInstance().collection<DigestDoc>(collection).findOne(filter, { projection: { entries: 1 } });
    if (own) return own.entries || [];
    const legacy = await dbInstance().collection<DigestDoc>(collection)
      .findOne({ date, resumeId: null }, { projection: { entries: 1 } });
    return legacy?.entries || [];
  }
  // Без резюме — все документы за дату (apply запускается без выбора резюме).
  const docs = await dbInstance().collection<DigestDoc>(collection)
    .find(filter, { projection: { entries: 1 } as any, sort: { updatedAt: -1 } })
    .toArray();
  return flattenDocs(docs);
}

// выводит все дайджесты без отклика
export async function getAllDigests(collection: string, resumeId?: string): Promise<DigestEntry[]> {
  await connect();
  const filter: any = {};
  if (resumeId) filter.resumeId = resumeId;
  let docs = await dbInstance().collection<DigestDoc>(collection)
    .find(filter, { projection: { entries: 1 } as any, sort: { date: -1, updatedAt: -1 } })
    .toArray();
  if (resumeId && !docs.length) {
    // Нет данных под это резюме — отдаём legacy-документы (как до обновления).
    docs = await dbInstance().collection<DigestDoc>(collection)
      .find({ resumeId: null }, { projection: { entries: 1 } as any, sort: { date: -1 } })
      .toArray();
  }
  return flattenDocs(docs);
}

// Все документы коллекции с датами — вход шага actualize. Свежие даты сверху.
export async function listDigestDocs(collection: string, resumeId?: string): Promise<DigestDoc[]> {
  await connect();
  const filter: any = {};
  if (resumeId) filter.resumeId = resumeId;
  const docs = await dbInstance().collection<DigestDoc>(collection)
    .find(filter, { projection: { date: 1, entries: 1, resumeId: 1, resumeName: 1 } as any, sort: { date: -1 } })
    .toArray();
  return docs.map(d => ({
    date: d.date,
    entries: d.entries || [],
    resumeId: d.resumeId ?? null,
    resumeName: d.resumeName ?? null,
  }));
}

// Последний дайджест — вход шагов cover и apply. null: MongoDB недоступна или дайджестов нет.
// Без resumeId — самый свежий документ среди всех резюме (tie-break по updatedAt).
export async function getLatestDigest(resumeId?: string): Promise<DigestDoc | null> {
  await connect();
  const coll = dbInstance().collection<DigestDoc>('digest');
  const findLatest = (filter: any) => coll.find(filter, {
    projection: { date: 1, entries: 1, resumeId: 1, resumeName: 1, updatedAt: 1 } as any,
    sort: { date: -1, updatedAt: -1 },
    limit: 1,
  }).toArray();

  const filter: any = {};
  if (resumeId) filter.resumeId = resumeId;
  let docs = await findLatest(filter);
  if (!docs.length && resumeId) {
    // Legacy-дайджест без привязки к резюме: показываем его, пока не пересобран под резюме.
    docs = await findLatest({ resumeId: null });
  }
  if (!docs.length) return null;
  const doc = docs[0];
  return {
    date: doc.date,
    entries: doc.entries || [],
    resumeId: doc.resumeId ?? null,
    resumeName: doc.resumeName ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
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
export async function writeDigest(entries: any[], date = dateKey(), resume?: ResumeRef | null): Promise<string[]> {
  if (!entries.length) return [];
  const files = writeArtifacts(digestDir(resume), entries, date, 'digest.md', 'Дайджест вакансий');
  await writeToMongo('digest', entries, date, resume);
  return files;
}

export async function writeRejected(entries: any[], date = dateKey(), resume?: ResumeRef | null): Promise<string[]> {
  if (!entries.length) return [];
  const files = writeArtifacts(rejectedDir(resume), entries, date, 'rejected.md', 'Отклонённые вакансии');
  await writeToMongo('rejected', entries, date, resume);
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
export function writeActualDigest(entries: any[], date = dateKey(), resume?: ResumeRef | null): string | null {
  return writeActualFile(digestDir(resume), entries, date, 'Дайджест вакансий (актуальные)');
}

// Сводный снимок актуальных отклонённых вакансий за дату.
export function writeActualRejected(entries: any[], date = dateKey(), resume?: ResumeRef | null): string | null {
  return writeActualFile(rejectedDir(resume), entries, date, 'Отклонённые вакансии (актуальные)');
}
