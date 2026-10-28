// Преобразования между строками SQLite и доменными объектами.
// JSON-колонки хранят «payload» (items, full, entries, meta): схема остаётся плоской,
// а форма данных ровно та же, что была в документах Mongo.

/**
 * Резюме без привязки: в Mongo это был null, в SQLite — пустая строка.
 * NULL в UNIQUE-индексе SQLite не конфликтует сам с собой, поэтому составные ключи
 * (date, resumeId) и (resumeId, vacancyId) перестали бы быть уникальными.
 */
export function resumeKey(resumeId?: string | null): string {
  return resumeId ? String(resumeId) : '';
}

/** Обратное преобразование: '' → null, чтобы наружу уходило прежнее значение. */
export function resumeIdFromKey(key: unknown): string | null {
  return typeof key === 'string' && key ? key : null;
}

/** Значение для JSON-колонки (undefined → null, как писал драйвер Mongo). */
export function toJson(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

/** Разбор JSON-колонки: битая строка не должна валить весь дайджест. */
export function fromJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Число из SQLite: драйвер отдаёт INTEGER как number либо bigint. */
export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** ISO-время из epoch-ms — формат, который ожидают порты (history.at, resume.createdAt). */
export function isoFromMs(value: unknown): string {
  return new Date(num(value)).toISOString();
}

/** Строка для NULL-колонки: пустая строка и undefined читаются как null. */
export function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** Список `?, ?, ?` для IN-запросов (пустой список вызывающая сторона отсекает сама). */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}
