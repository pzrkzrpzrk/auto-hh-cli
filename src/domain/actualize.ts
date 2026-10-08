// Актуализация старых дайджестов/rejected по последнему поиску.
// Записи, которых нет в текущей выдаче, помечаются archived (не удаляются).
// Логика чистая (без Mongo) — её удобно проверять на синтетических данных.
import type { DigestDoc, DigestEntry } from "../types.js";

export interface ActualizeOptions {
  // Идентификаторы вакансий из последнего поиска.
  todayIds: Set<string>;
  // Дата последнего поиска (ГГГГ-ММ-ДД). Документы с этой датой и позже не трогаем.
  today: string;
  // Окно поиска в днях (config.search.search_period). Вакансия старше окна законно
  // отсутствует в выдаче — её не помечаем архивом (иначе будут ложные срабатывания).
  searchPeriod?: number | null;
}

export interface ActualizeStats {
  dates: number;
  total: number;
  marked: number;
  unmarked: number;
  changedDates: number;
}

// Документ после актуализации: changed=true — нужно перезаписать (Mongo + .md).
export interface ActualizedDoc {
  date: string;
  entries: DigestEntry[];
  changed: boolean;
}

// Возраст записи в днях относительно today по publishedAt; null — даты нет/невалидна.
function ageInDays(publishedAt: string | null | undefined, today: string): number | null {
  if (!publishedAt) return null;
  const published = Date.parse(`${String(publishedAt).slice(0, 10)}T00:00:00.000Z`);
  const ref = Date.parse(`${today}T00:00:00.000Z`);
  if (Number.isNaN(published) || Number.isNaN(ref)) return null;
  return Math.floor((ref - published) / 86400000);
}

// Обновляет одну запись: есть в поиске → живая; нет и в окне поиска → архив.
function actualizeEntry(entry: DigestEntry, opts: ActualizeOptions): { entry: DigestEntry; archived: boolean; changed: boolean } {
  const present = opts.todayIds.has(String(entry.id));
  const age = ageInDays(entry.publishedAt, opts.today);
  const outOfWindow = Boolean(opts.searchPeriod) && age != null && age > opts.searchPeriod;
  const archived = present ? false : (outOfWindow ? Boolean(entry.archived) : true);
  const lastSeenAt = present ? opts.today : (entry.lastSeenAt ?? null);
  const changed = archived !== Boolean(entry.archived)
    || lastSeenAt !== (entry.lastSeenAt ?? null)
    || entry.checkedAt !== opts.today;
  return { entry: { ...entry, archived, lastSeenAt, checkedAt: opts.today }, archived, changed };
}

/**
 * Прогоняет документы (даты < today) через актуализацию. Возвращает обновлённые
 * документы и сводку. Идемпотентно: повторный прогон в тот же день ничего не меняет.
 */
export function computeActualization(
  docs: DigestDoc[],
  opts: ActualizeOptions,
): { docs: ActualizedDoc[]; stats: ActualizeStats } {
  const out: ActualizedDoc[] = [];
  const stats: ActualizeStats = { dates: 0, total: 0, marked: 0, unmarked: 0, changedDates: 0 };

  for (const doc of docs) {
    if (doc.date >= opts.today) continue; // текущий дайджест — не трогаем
    const entries = doc.entries || [];
    let changed = false;
    let marked = 0;
    const next = entries.map(e => {
      const r = actualizeEntry(e, opts);
      if (r.archived) marked++;
      if (r.changed) changed = true;
      return r.entry;
    });

    stats.dates++;
    stats.total += entries.length;
    stats.marked += marked;
    stats.unmarked += entries.length - marked;
    if (changed) stats.changedDates++;
    out.push({ date: doc.date, entries: next, changed });
  }

  return { docs: out, stats };
}

/**
 * Сливает актуализированные документы разных дат в один список для сводного файла (actual.md).
 * Дедуп по id: если вакансия встречалась в нескольких датах, берём запись с самой свежей датой
 * (её статус archived/lastSeenAt — самый актуальный). Порядок: живые сверху, затем архивные;
 * внутри группы — по свежести даты, затем по убыванию оценки. Чистая функция (легко тестировать).
 */
export function mergeActualized(docs: ActualizedDoc[]): DigestEntry[] {
  const byId = new Map<string, { entry: DigestEntry; sourceDate: string }>();
  for (const doc of docs) {
    for (const entry of doc.entries || []) {
      const key = String(entry.id);
      const prev = byId.get(key);
      if (!prev || doc.date > prev.sourceDate) byId.set(key, { entry, sourceDate: doc.date });
    }
  }
  return [...byId.values()]
    .sort((a, b) => {
      const byArchived = Number(Boolean(a.entry.archived)) - Number(Boolean(b.entry.archived));
      if (byArchived) return byArchived;
      if (a.sourceDate !== b.sourceDate) return a.sourceDate < b.sourceDate ? 1 : -1;
      return (b.entry.score ?? 0) - (a.entry.score ?? 0);
    })
    .map(x => x.entry);
}
