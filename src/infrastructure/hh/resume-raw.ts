// Низкоуровневый доступ к сырому JSON initial state hh.ru: обёртки схемы, даты,
// обход дерева и приведение значений к тексту. Модуль чистый (без I/O и Playwright).
//
// Структура страниц hh.ru меняется, поэтому объекты ищутся «по форме», а поля
// читаются перебором альтернативных ключей (pick), а не жёстким путём.

// hash резюме на hh.ru — 40 hex-символов; 16 — запас на случай смены длины.
const HASH_RE = /^[0-9a-f]{16,}$/i;

export function isObject(value: any): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function pick(obj: any, ...keys: string[]): any {
  if (!isObject(obj)) return null;
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  return null;
}

/** object | строка | число → строка (для полей hh, где текст бывает в name/title/visibleName). */
export function asText(value: any): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (isObject(value)) {
    return asText(value.name ?? value.title ?? value.text ?? value.visibleName ?? value.type?.name ?? value.id);
  }
  return null;
}

export function asString(value: any): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

export function asNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

// Поля резюме в initial state hh завёрнуты по одному: [{ string: "Павел" }],
// [{ date: "1991-10-18" }], [{ string: 113 }]. Разворачиваем такие обёртки, а объекты
// с несколькими ключами (опыт, телефон, контакт) оставляем как есть.
const SCHEME_WRAPPER_KEYS = new Set(['string', 'date', 'id', 'number', 'boolean', 'url']);

export function unwrapValue(value: any): any {
  if (!Array.isArray(value)) return value;
  const items = value.map(item => {
    if (!isObject(item)) return item;
    const keys = Object.keys(item);
    if (keys.length !== 1 || !SCHEME_WRAPPER_KEYS.has(keys[0])) return item;
    return item[keys[0]];
  });
  return items.length === 1 ? items[0] : items;
}

/** Название региона: числовой id без справочника локацией не считаем. */
export function placeName(value: any): string | null {
  const text = asText(value);
  return text && !/^\d+$/.test(text) ? text : null;
}

export function hashOf(value: any): string | null {
  // В схеме редактора hash лежит во вложенном _attributes.
  const hash = asString(pick(value, 'hash', 'resumeHash', 'resume_hash', 'id'))
    || asString(pick(value?._attributes, 'hash', 'resumeHash'));
  return hash && HASH_RE.test(hash) ? hash : null;
}

/** Период работы: 2020-03 → «03.2020», год без месяца → «2020». */
export function dateStr(value: any): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[2]}.${iso[1]}`;
    if (/^\d{4}$/.test(value)) return value;
    return value.trim() || null;
  }
  if (typeof value === 'number') return String(value);
  if (isObject(value)) {
    const year = asNumber(pick(value, 'year'));
    const month = asNumber(pick(value, 'month'));
    if (year != null) return month != null ? `${String(month).padStart(2, '0')}.${year}` : String(year);
    return dateStr(pick(value, 'date', 'value', 'iso'));
  }
  return null;
}

/**
 * Полная дата (день рождения): dateStr схлопывает ISO до «03.1990», для периода
 * работы это верно, а для даты рождения теряется день.
 */
export function fullDateStr(value: any): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
    return value.trim() || null;
  }
  if (isObject(value)) {
    const year = asNumber(pick(value, 'year'));
    const month = asNumber(pick(value, 'month'));
    const day = asNumber(pick(value, 'day'));
    if (year != null) {
      const parts = [day, month, year].filter((part): part is number => part != null);
      const last = parts.length - 1;
      return parts.map((part, index) => (index === last ? String(part) : String(part).padStart(2, '0'))).join('.');
    }
    return fullDateStr(pick(value, 'date', 'value', 'iso'));
  }
  return dateStr(value);
}

/** Обход JSON без рекурсии в глубину больше limit: initialState бывает большим. */
export function walk(value: any, visit: (obj: any) => void, depth = 0, limit = 12): void {
  if (value == null || depth > limit) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1, limit);
    return;
  }
  if (!isObject(value)) return;
  visit(value);
  for (const item of Object.values(value)) walk(item, visit, depth + 1, limit);
}
