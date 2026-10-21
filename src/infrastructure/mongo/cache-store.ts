// Кэш в отдельных MongoDB коллекциях: cachePages, cacheFull, cacheJudgements, cacheCoverLetters.
import { connect, dbInstance } from "@/infrastructure/mongo/db.js";
import { dateKey } from "@/shared/time.js";
import type { Vacancy } from "@/domain/models.js";
import type { VacancyListItem } from "@/domain/search/types.js";
import type { Judgement } from "@/domain/digest/JudgementSet.js";

export interface CacheDoc {
  date: string;
  pages: Record<string, VacancyListItem[]>;
  fullById: Record<string, Vacancy>;
  judgements: Record<string, Judgement>;
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

// pageNum: номер страницы прохода; у «удалённого» прохода ключ с префиксом (remote:N).
export async function savePage(state: CacheDoc, pageNum: number | string, date?: Date): Promise<void> {
  await connect();
  await dbInstance().collection('cachePages').updateOne(
    { date: dateKey(date), page: pageNum },
    { $set: { items: state.pages?.[String(pageNum)] || [] } },
    { upsert: true },
  );
}

// Полная вакансия (описание, навыки): нужна и шагу digest, и шагу cover.
export async function saveFullVacancy(vacancy: Vacancy, date?: Date): Promise<void> {
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
export function getFullByVacancyIds(vacancyIds: (string | number)[]): Promise<Record<string, Vacancy>> {
  return findByIds('cacheFull', vacancyIds, 'full') as Promise<Record<string, Vacancy>>;
}

// Запись вердиктов по карте vacancyId → judgement. Отдельная функция нужна адаптеру
// JudgementCache: сценарию дайджеста не обязательно держать весь CacheDoc.
// resumeId — измерение: дата + резюме + вакансия. Без резюме чистим только «нулевое» ведро,
// иначе digest без резюме стирал бы вердикты всех остальных резюме за эту дату.
export async function saveJudgementsMap(
  judgements: Record<string, Judgement>,
  resumeId?: string,
  date?: Date,
): Promise<void> {
  await connect();
  const db = dbInstance();
  const key = dateKey(date);
  const coll = db.collection('cacheJudgements');
  await coll.deleteMany({ date: key, resumeId: resumeId || null });
  const docs = Object.entries(judgements || {}).map(([vid, j]) => ({
    date: key, resumeId: resumeId || null, vacancyId: vid, score: j.score, fit: j.fit,
    reason: j.reason, comment: j.comment,
  }));
  if (docs.length) await coll.insertMany(docs);
}

export async function saveJudgements(state: CacheDoc, resumeId?: string, date?: Date): Promise<void> {
  return saveJudgementsMap(state.judgements, resumeId, date);
}

/** Различные resumeId в кэше вердиктов — для проверки «сирот» в `resume list`. */
export async function listJudgementResumeIds(): Promise<string[]> {
  await connect();
  const ids = await dbInstance().collection('cacheJudgements').distinct('resumeId');
  return ids.filter((id: any): id is string => typeof id === 'string' && Boolean(id));
}

/** Сброс вердиктов одного резюме. Возвращает число удалённых документов. */
export async function clearJudgementsByResume(resumeId: string): Promise<number> {
  await connect();
  const r = await dbInstance().collection('cacheJudgements').deleteMany({ resumeId });
  return r.deletedCount ?? 0;
}

// Одно письмо: пишется шагом cover, читается `digest show` и `apply`.
// Ключ — резюме + вакансия: письма под разные резюме не перетирают друг друга.
export async function saveLetter(vacancyId: string, letter: string, resumeId?: string): Promise<void> {
  await connect();
  await dbInstance().collection('cacheCoverLetters').updateOne(
    { vacancyId: String(vacancyId), resumeId: resumeId || null },
    {
      $set: {
        date: dateKey(),
        vacancyId: String(vacancyId),
        resumeId: resumeId || null,
        letter,
      },
    },
    { upsert: true },
  );
}

/**
 * Письма по id вакансий. resumeId — строгий фильтр (письма именно этого резюме).
 * Без фильтра legacy-письма (resumeId: null) сортируются первыми, чтобы письма
 * с привязкой к резюме перекрывали их в итоговой карте.
 */
export async function getLettersByVacancyIds(
  vacancyIds: (string | number)[],
  resumeId?: string,
): Promise<Record<string, string>> {
  const ids = [...new Set(vacancyIds.map(String))];
  const out: Record<string, string> = {};
  if (!ids.length) return out;
  await connect();
  const filter: any = { vacancyId: { $in: ids } };
  if (resumeId) filter.resumeId = resumeId;
  const docs = await dbInstance().collection('cacheCoverLetters')
    .find(filter)
    .sort({ resumeId: 1, date: -1 })
    .toArray();
  for (const d of docs) if (d.letter) out[String(d.vacancyId)] = d.letter;
  return out;
}

/** Различные resumeId в кэше писем — для проверки «сирот» в `resume list`. */
export async function listLetterResumeIds(): Promise<string[]> {
  await connect();
  const ids = await dbInstance().collection('cacheCoverLetters').distinct('resumeId');
  return ids.filter((id: any): id is string => typeof id === 'string' && Boolean(id));
}

/** Сброс писем одного резюме. Возвращает число удалённых документов. */
export async function clearLettersByResume(resumeId: string): Promise<number> {
  await connect();
  const r = await dbInstance().collection('cacheCoverLetters').deleteMany({ resumeId });
  return r.deletedCount ?? 0;
}

// Единственное место логики «подклеить письма из кэша к записям дайджеста».
// force=true — считать, что писем нет ни в кэше, ни в записи (перегенерировать всё).
// resumeId — брать только письма этого резюме (шаги cover/apply). Письмо в самой записи
// (coverLetter) тоже учитывается только если помечено тем же резюме.
export async function withCoverLetters<
  T extends { id: string | number; coverLetter?: string; coverLetterResumeId?: string | null },
>(entries: T[], opts: { force?: boolean; resumeId?: string } = {}): Promise<T[]> {
  const letters = await getLettersByVacancyIds(entries.map(e => e.id), opts.resumeId)
    .catch(() => ({} as Record<string, string>));
  return entries.map(e => {
    // Письмо в записи отбрасываем только если оно явно помечено другим резюме.
    // Legacy-письма (без пометки) остаются доступны — иначе после обновления
    // пришлось бы перегенерировать все письма заново.
    const foreign = Boolean(opts.resumeId && e.coverLetterResumeId && e.coverLetterResumeId !== opts.resumeId);
    const fromEntry = foreign ? '' : (e.coverLetter || '');
    return {
      ...e,
      coverLetter: opts.force ? '' : (letters[String(e.id)] || fromEntry),
    };
  });
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
