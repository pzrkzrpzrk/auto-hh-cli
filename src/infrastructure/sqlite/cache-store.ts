// Кэш в отдельных таблицах SQLite: cache_pages, cache_full, cache_judgements, cache_cover_letters.
// Имена экспортов сохранены с версии на Mongo: composition подставляет модуль как порт CacheStore,
// а search, digest и cover работают через него же.
import { clearTable, connect, transaction } from "@/infrastructure/sqlite/db.js";
import {
  fromJson,
  num,
  placeholders,
  resumeIdFromKey,
  resumeKey,
  toJson,
} from "@/infrastructure/sqlite/rows.js";
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

interface Row {
  [key: string]: unknown;
}

/** Вердикт из строки cache_judgements: наружу уходит та же форма, что была в Mongo. */
function toJudgement(row: Row): Judgement {
  return {
    score: num(row.score),
    fit: Boolean(row.fit),
    reason: (row.reason as string | null) ?? null,
    comment: (row.comment as string | null) ?? null,
  };
}

export async function load(date?: Date, resumeId?: string): Promise<CacheDoc> {
  const db = connect();
  const key = dateKey(date);

  const pages: Record<string, VacancyListItem[]> = {};
  for (const row of db.prepare('SELECT page, items FROM cache_pages WHERE date = ?').all(key) as Row[]) {
    pages[String(row.page)] = fromJson<VacancyListItem[]>(row.items, []);
  }

  const fullById: Record<string, Vacancy> = {};
  for (const row of db.prepare('SELECT vacancy_id, full FROM cache_full WHERE date = ?').all(key) as Row[]) {
    const full = fromJson<Vacancy | null>(row.full, null);
    if (full) fullById[String(row.vacancy_id)] = full;
  }

  const judgementRows = resumeId
    ? db.prepare('SELECT * FROM cache_judgements WHERE date = ? AND resume_id = ?').all(key, resumeKey(resumeId))
    : db.prepare('SELECT * FROM cache_judgements WHERE date = ?').all(key);
  const judgements: Record<string, Judgement> = {};
  for (const row of judgementRows as Row[]) judgements[String(row.vacancy_id)] = toJudgement(row);

  // Без фильтра по резюме: legacy-письма ('') идут первыми, письма резюме перекрывают их.
  const letterRows = resumeId
    ? db.prepare('SELECT vacancy_id, letter FROM cache_cover_letters WHERE resume_id = ? ORDER BY date DESC')
      .all(resumeKey(resumeId))
    : db.prepare('SELECT vacancy_id, letter FROM cache_cover_letters ORDER BY resume_id, date DESC').all();
  const coverLetters: Record<string, string> = {};
  for (const row of letterRows as Row[]) coverLetters[String(row.vacancy_id)] = String(row.letter);

  return { date: key, pages, fullById, judgements, coverLetters };
}

// Дата последнего собранного поиска — по ней же ключуются pages/full/judgements.
export async function latestDateWithPages(): Promise<string | null> {
  const row = connect().prepare('SELECT date FROM cache_pages ORDER BY date DESC LIMIT 1').get() as Row | undefined;
  return row ? String(row.date) : null;
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
  const items = state.pages?.[String(pageNum)] || [];
  connect().prepare(
    `INSERT INTO cache_pages (date, page, items) VALUES (?, ?, ?)
     ON CONFLICT (date, page) DO UPDATE SET items = excluded.items`,
  ).run(dateKey(date), String(pageNum), toJson(items));
}

// Полная вакансия (описание, навыки): нужна и шагу digest, и шагу cover.
export async function saveFullVacancy(vacancy: Vacancy, date?: Date): Promise<void> {
  const vacancyId = String(vacancy.id);
  connect().prepare(
    `INSERT INTO cache_full (vacancy_id, date, full) VALUES (?, ?, ?)
     ON CONFLICT (vacancy_id) DO UPDATE SET date = excluded.date, full = excluded.full`,
  ).run(vacancyId, dateKey(date), toJson(vacancy));
}

// Единый поиск по id: dedupe → IN (...) → карта «vacancyId → значение поля».
async function findByIds(vacancyIds: (string | number)[]): Promise<Record<string, Vacancy>> {
  const ids = [...new Set(vacancyIds.map(String))];
  const out: Record<string, Vacancy> = {};
  if (!ids.length) return out;
  const rows = connect()
    .prepare(`SELECT vacancy_id, full FROM cache_full WHERE vacancy_id IN (${placeholders(ids.length)})`)
    .all(...ids) as Row[];
  for (const row of rows) {
    const full = fromJson<Vacancy | null>(row.full, null);
    if (full) out[String(row.vacancy_id)] = full;
  }
  return out;
}

// Полные вакансии по id — чтобы шаг cover не ходил на hh.ru лишний раз.
export function getFullByVacancyIds(vacancyIds: (string | number)[]): Promise<Record<string, Vacancy>> {
  return findByIds(vacancyIds);
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
  const db = connect();
  const key = dateKey(date);
  const resume = resumeKey(resumeId);
  const upsert = db.prepare(
    `INSERT INTO cache_judgements (date, resume_id, vacancy_id, score, fit, reason, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (date, resume_id, vacancy_id) DO UPDATE SET
       score = excluded.score,
       fit = excluded.fit,
       reason = excluded.reason,
       comment = excluded.comment`,
  );
  // Вердикты дня перезаписываются целиком — как deleteMany + insertMany в Mongo.
  transaction(() => {
    db.prepare('DELETE FROM cache_judgements WHERE date = ? AND resume_id = ?').run(key, resume);
    for (const [vid, judgement] of Object.entries(judgements || {})) {
      upsert.run(
        key,
        resume,
        vid,
        num(judgement?.score),
        judgement?.fit ? 1 : 0,
        judgement?.reason ?? null,
        judgement?.comment ?? null,
      );
    }
  });
}

export async function saveJudgements(state: CacheDoc, resumeId?: string, date?: Date): Promise<void> {
  return saveJudgementsMap(state.judgements, resumeId, date);
}

/** Различные resumeId в кэше вердиктов — для проверки «сирот» в `resume list`. */
export async function listJudgementResumeIds(): Promise<string[]> {
  const rows = connect().prepare('SELECT DISTINCT resume_id FROM cache_judgements').all() as Row[];
  return rows.map(row => resumeIdFromKey(row.resume_id)).filter((id): id is string => Boolean(id));
}

/** Сброс вердиктов одного резюме. Возвращает число удалённых строк. */
export async function clearJudgementsByResume(resumeId: string): Promise<number> {
  return clearTable('cache_judgements', { where: 'resume_id = ?', params: [resumeKey(resumeId)] });
}

// Одно письмо: пишется шагом cover, читается `digest show` и `apply`.
// Ключ — резюме + вакансия: письма под разные резюме не перетирают друг друга.
export async function saveLetter(vacancyId: string, letter: string, resumeId?: string): Promise<void> {
  connect().prepare(
    `INSERT INTO cache_cover_letters (resume_id, vacancy_id, date, letter) VALUES (?, ?, ?, ?)
     ON CONFLICT (resume_id, vacancy_id) DO UPDATE SET date = excluded.date, letter = excluded.letter`,
  ).run(resumeKey(resumeId), String(vacancyId), dateKey(), letter);
}

/**
 * Письма по id вакансий. resumeId — строгий фильтр (письма именно этого резюме).
 * Без фильтра legacy-письма (resume_id = '') идут первыми, чтобы письма с привязкой
 * к резюме перекрывали их в итоговой карте — порядок как у Mongo sort({ resumeId: 1, date: -1 }).
 */
export async function getLettersByVacancyIds(
  vacancyIds: (string | number)[],
  resumeId?: string,
): Promise<Record<string, string>> {
  const ids = [...new Set(vacancyIds.map(String))];
  const out: Record<string, string> = {};
  if (!ids.length) return out;
  const db = connect();
  const list = placeholders(ids.length);
  const rows = resumeId
    ? db.prepare(
      `SELECT vacancy_id, letter FROM cache_cover_letters
       WHERE vacancy_id IN (${list}) AND resume_id = ? ORDER BY date DESC`,
    ).all(...ids, resumeKey(resumeId))
    : db.prepare(
      `SELECT vacancy_id, letter FROM cache_cover_letters
       WHERE vacancy_id IN (${list}) ORDER BY resume_id, date DESC`,
    ).all(...ids);
  for (const row of rows as Row[]) if (row.letter) out[String(row.vacancy_id)] = String(row.letter);
  return out;
}

/** Различные resumeId в кэше писем — для проверки «сирот» в `resume list`. */
export async function listLetterResumeIds(): Promise<string[]> {
  const rows = connect().prepare('SELECT DISTINCT resume_id FROM cache_cover_letters').all() as Row[];
  return rows.map(row => resumeIdFromKey(row.resume_id)).filter((id): id is string => Boolean(id));
}

/** Сброс писем одного резюме. Возвращает число удалённых строк. */
export async function clearLettersByResume(resumeId: string): Promise<number> {
  return clearTable('cache_cover_letters', { where: 'resume_id = ?', params: [resumeKey(resumeId)] });
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
  const tables = ['cache_pages', 'cache_full', 'cache_judgements', 'cache_cover_letters'];
  const removed: string[] = [];
  for (const table of tables) {
    const deleted = clearTable(table);
    if (deleted) removed.push(`${table}: ${deleted}`);
  }
  return removed;
}
