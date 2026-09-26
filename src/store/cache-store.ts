// Кэш в отдельных MongoDB коллекциях: cachePages, cacheFull, cacheJudgements, cacheCoverLetters.
import { connect, dbInstance } from "../clients/db.js";

function dateKey(d?: Date): string {
  return (d || new Date()).toISOString().slice(0, 10);
}

export interface CacheDoc {
  date: string;
  pages: Record<string, any[]>;
  fullById: Record<string, any>;
  judgements: Record<string, any>;
  coverLetters: Record<string, string>;
}

export async function load(date?: Date, resumeId?: string): Promise<CacheDoc> {
  await connect();
  const db = dbInstance();
  const key = dateKey(date);

  const judgeFilter: any = { date: key };
  const coverFilter: any = {};
  if (resumeId) {
    judgeFilter.resumeId = resumeId;
    coverFilter.resumeId = resumeId;
  }

  const [pageDocs, fullDocs, judgeDocs, coverDocs] = await Promise.all([
    db.collection('cachePages').find({ date: key }).toArray(),
    db.collection('cacheFull').find({ date: key }).toArray(),
    db.collection('cacheJudgements').find(judgeFilter).toArray(),
    db.collection('cacheCoverLetters').find(coverFilter).toArray(),
  ]);

  const pages: Record<string, any[]> = {};
  for (const d of pageDocs) pages[String(d.page)] = d.items;

  const fullById: Record<string, any> = {};
  for (const d of fullDocs) fullById[d.vacancyId] = d.full;

  const judgements: Record<string, any> = {};
  for (const d of judgeDocs) {
    const { vacancyId, _id, date: _, ...rest } = d;
    judgements[vacancyId] = rest;
  }

  const coverLetters: Record<string, string> = {};
  for (const d of coverDocs) coverLetters[d.vacancyId] = d.letter;

  return { date: key, pages, fullById, judgements, coverLetters };
}

// Дата последнего собранного поиска — по ней же ключуются pages/full/judgements.
export async function latestDateWithPages(): Promise<string | null> {
  await connect();
  const docs = await dbInstance().collection('cachePages')
    .find({}, { projection: { date: 1 }, sort: { date: -1 }, limit: 1 })
    .toArray();
  return docs.length ? String(docs[0].date) : null;
}

// Кэш последнего поиска (не строго сегодняшнего) — вход шага digest.
// Позволяет запускать `search` вечером, а `digest` — хоть на следующий день.
export async function loadLatest(resumeId?: string): Promise<CacheDoc | null> {
  const date = await latestDateWithPages();
  if (!date) return null;
  return load(new Date(`${date}T00:00:00.000Z`), resumeId);
}

export async function savePage(state: CacheDoc, pageNum: number, date?: Date): Promise<void> {
  await connect();
  await dbInstance().collection('cachePages').updateOne(
    { date: dateKey(date), page: pageNum },
    { $set: { items: state.pages?.[String(pageNum)] || [] } },
    { upsert: true },
  );
}

// Полная вакансия (описание, навыки): нужна и шагу digest, и шагу cover.
export async function saveFullVacancy(vacancy: any, date?: Date): Promise<void> {
  await connect();
  const vacancyId = String(vacancy.id);
  await dbInstance().collection('cacheFull').updateOne(
    { vacancyId },
    { $set: { date: dateKey(date), vacancyId, full: vacancy } },
    { upsert: true },
  );
}

// Единый поиск по id: dedupe → $in → карта «vacancyId → значение поля».
async function findByIds(collection: string, vacancyIds: (string | number)[], valueField: string): Promise<Record<string, any>> {
  const ids = [...new Set(vacancyIds.map(String))];
  const out: Record<string, any> = {};
  if (!ids.length) return out;
  await connect();
  const docs = await dbInstance().collection(collection).find({ vacancyId: { $in: ids } }).toArray();
  for (const d of docs) if (d[valueField]) out[String(d.vacancyId)] = d[valueField];
  return out;
}

// Полные вакансии по id — чтобы шаг cover не ходил на hh.ru лишний раз.
export function getFullByVacancyIds(vacancyIds: (string | number)[]): Promise<Record<string, any>> {
  return findByIds('cacheFull', vacancyIds, 'full');
}

export async function saveJudgements(state: CacheDoc, resumeId?: string, date?: Date): Promise<void> {
  await connect();
  const db = dbInstance();
  const key = dateKey(date);
  const coll = db.collection('cacheJudgements');
  const filter: any = { date: key };
  if (resumeId) filter.resumeId = resumeId;
  await coll.deleteMany(filter);
  const docs = Object.entries(state.judgements || {}).map(([vid, j]) => ({
    date: key, resumeId: resumeId || null, vacancyId: vid, score: j.score, fit: j.fit,
    reason: j.reason, comment: j.comment,
  }));
  if (docs.length) await coll.insertMany(docs);
}

// Одно письмо: пишется шагом cover, читается `digest show` и `apply`.
export async function saveLetter(vacancyId: string, letter: string, date?: Date): Promise<void> {
  await connect();
  await dbInstance().collection('cacheCoverLetters').updateOne(
    { vacancyId: String(vacancyId) },
    { $set: { date: dateKey(date), vacancyId: String(vacancyId), letter } },
    { upsert: true },
  );
}

export function getLettersByVacancyIds(vacancyIds: (string | number)[]): Promise<Record<string, string>> {
  return findByIds('cacheCoverLetters', vacancyIds, 'letter') as Promise<Record<string, string>>;
}

// Единственное место логики «подклеить письма из кэша к записям дайджеста».
// force=true — считать, что писем нет ни в кэше, ни в записи (перегенерировать всё).
export async function withCoverLetters<T extends { id: string | number; coverLetter?: string }>(
  entries: T[],
  opts: { force?: boolean } = {},
): Promise<T[]> {
  const letters = await getLettersByVacancyIds(entries.map(e => e.id)).catch(() => ({} as Record<string, string>));
  return entries.map(e => ({
    ...e,
    coverLetter: opts.force ? '' : (letters[String(e.id)] || e.coverLetter || ''),
  }));
}

export async function clear(): Promise<string[]> {
  await connect();
  const db = dbInstance();
  const collections = ['cachePages', 'cacheFull', 'cacheJudgements', 'cacheCoverLetters'];
  const removed: string[] = [];
  for (const coll of collections) {
    const r = await db.collection(coll).deleteMany({});
    if (r.deletedCount) removed.push(`${coll}: ${r.deletedCount}`);
  }
  return removed;
}
