// Хранилище истории откликов в MongoDB.
import { connect, dbInstance } from "../clients/db.js";
import { Collection, Document } from "mongodb";

const COLLECTION = 'history';

interface HistoryDoc {
  vacancyId: string;
  status: 'seen' | 'applied';
  at: Date;
  meta?: Record<string, any>;
}

async function col(): Promise<Collection<HistoryDoc>> {
  await connect();
  return dbInstance().collection<HistoryDoc>(COLLECTION);
}

export async function load(): Promise<{ applied: Record<string, any>; seen: Record<string, string> }> {
  const c = await col();
  const docs = await c.find({}).toArray();
  const applied: Record<string, any> = {};
  const seen: Record<string, string> = {};
  for (const d of docs) {
    // meta несёт title/employer/url/score (пишут cmd-apply и cmd-digest) — без него `history`
    // печатает только id, а `apply` не отличает digest-only отметку от реального отклика.
    if (d.status === 'applied') applied[d.vacancyId] = { ...(d.meta || {}), at: d.at.toISOString() };
    seen[d.vacancyId] = d.at.toISOString();
  }
  return { applied, seen };
}

export async function markApplied(vacancyId: string, meta: Record<string, any>): Promise<void> {
  const c = await col();
  await c.updateOne(
    { vacancyId: String(vacancyId) },
    { $set: { vacancyId: String(vacancyId), status: 'applied', at: new Date(), meta } },
    { upsert: true },
  );
}

// Важно: 'seen' не должен затирать реальный отклик ('applied'),
// иначе apply снова попробует откликнуться на эту вакансию.
// Вариант «фильтр status: { $ne: 'applied' } + upsert» здесь не годится: если документ уже
// 'applied', фильтр не совпадёт и upsert упрётся в уникальный индекс { vacancyId: 1 } (E11000).
// Поэтому статус применяется условно в pipeline, а 'applied' остаётся нетронутым — один атомарный update.
function seenUpdate(vacancyId: string, at: Date): Document[] {
  return [{ $set: {
    vacancyId,
    status: { $cond: [{ $eq: ['$status', 'applied'] }, 'applied', 'seen'] },
    at: { $cond: [{ $eq: ['$status', 'applied'] }, '$at', at] },
  } }];
}

export async function markSeen(vacancyId: string): Promise<void> {
  const c = await col();
  const id = String(vacancyId);
  await c.updateOne({ vacancyId: id }, seenUpdate(id, new Date()), { upsert: true });
}

// Пакетная отметка «просмотрено»: один bulkWrite на весь список вместо запроса на каждую вакансию.
// Если процесс упадёт до этого вызова, часть отметок потеряется — шаг идемпотентен, это допустимо.
export async function markSeenMany(vacancyIds: (string | number)[]): Promise<void> {
  const ids = [...new Set(vacancyIds.map(String))];
  if (!ids.length) return;
  const c = await col();
  const at = new Date();
  await c.bulkWrite(
    ids.map(vacancyId => ({ updateOne: { filter: { vacancyId }, update: seenUpdate(vacancyId, at), upsert: true } })),
    { ordered: false },
  );
}

export async function isApplied(vacancyId: string): Promise<boolean> {
  const c = await col();
  const doc = await c.findOne({ vacancyId: String(vacancyId), status: 'applied' });
  return Boolean(doc);
}

export async function isSeen(vacancyId: string): Promise<boolean> {
  const c = await col();
  const doc = await c.findOne({ vacancyId: String(vacancyId) });
  return Boolean(doc);
}

const _default = { load, markApplied, markSeen, markSeenMany, isApplied, isSeen };
export default _default;
