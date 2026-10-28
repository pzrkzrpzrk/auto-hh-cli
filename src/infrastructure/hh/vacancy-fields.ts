// Разбор полей initial state hh.ru: сущности, коды справочников и флаги.
// Модуль чистый (без Playwright): его функции используются и поиском, и карточкой,
// и проверяются тестами на сохранённых payload'ах.
export interface MappedSalary {
  from: number | null;
  to: number | null;
  currency: string | null;
  gross?: boolean;
}

export interface RawCompensation {
  from?: number | null;
  to?: number | null;
  currencyCode?: string | null;
  gross?: boolean;
  noCompensation?: boolean;
}

/** Справочники кодов из vacancyFieldsDictionary: поле → (код → текст). */
export type FieldsDictionary = Record<string, Map<string, string>>;

export function decodeEntities(s: unknown): string {
  if (!s) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function mapCompensation(c: RawCompensation | null | undefined): MappedSalary | null {
  if (!c) return null;
  if (c.noCompensation) return null;
  if (!c.from && !c.to) return null;
  return {
    from: c.from || null,
    to: c.to || null,
    currency: c.currencyCode || null,
    gross: c.gross,
  };
}

// Справочники кодов («FULL», «FIVE_ON_TWO_OFF», «moreThan6») → человекочитаемый текст.
// Лежат в initialState.vacancyFieldsDictionary как [{ id, text }].
export function buildFieldsDictionary(dict: Record<string, unknown> | null | undefined): FieldsDictionary {
  const out: FieldsDictionary = {};
  if (!dict) return out;
  for (const [key, list] of Object.entries(dict)) {
    if (!Array.isArray(list)) continue;
    const map = new Map<string, string>();
    for (const item of list) {
      if (item && item.id != null) map.set(String(item.id), decodeEntities(item.text) || String(item.id));
    }
    if (map.size) out[key] = map;
  }
  return out;
}

// Код из справочника → текст («FULL» → «Полная занятость»); null, если код неизвестен.
export function translateCode(
  fields: FieldsDictionary | null | undefined,
  key: string,
  code: unknown,
): string | null {
  if (code == null) return null;
  const map = fields?.[key];
  return (map && map.get(String(code))) || null;
}

// Первый код поля: строка | [{ id, text }] → строка.
export function firstCode(v: unknown): string | number | null {
  if (Array.isArray(v)) return v.length ? (v[0]?.id ?? v[0]) : null;
  if (v && typeof v === 'object') return (v as { id?: string | number }).id ?? null;
  return (v as string | number) ?? null;
}

// { id, text } | строка → текст.
export function objectName(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return null;
  const obj = v as Record<string, any>;
  return obj.text ?? obj.name ?? obj.title ?? obj.id ?? null;
}

// keySkills новой карточки — массив строк (в старом API — [{ name }]).
export function toKeySkills(v: unknown): { name: string }[] {
  const raw = v && typeof v === 'object' && 'keySkill' in v ? (v as Record<string, unknown>).keySkill : v;
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((k): string => (typeof k === 'string' ? k : String(k?.name || k?.title || k?.text || '')))
    .filter(Boolean)
    .map(name => ({ name }));
}

// Список кодов (формат работы). Переводить их в текст нельзя: коды («ON_SITE», «REMOTE»,
// «HYBRID») разбирает filter.ts.
export function toCodeList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : (v == null ? [] : [v]);
  return list
    .map(x => (typeof x === 'string' ? x : (x?.id ?? x?.code ?? x?.name ?? null)))
    .filter((x): x is string | number => x != null)
    .map(String);
}

// Архивность. В новой карточке status = { archived, disabled, ... } ({archived:false} у живых),
// в старом API — status.active. Неизвестный статус считаем НЕ архивным: иначе смена формы
// ответа помечает архивом всю выдачу (ровно этот дефект и был: archived = !status?.active,
// а поля active в новом payload нет → true для живых вакансий).
export function isArchived(v: Record<string, any>): boolean {
  const st = v?.status;
  if (st) {
    if (typeof st.archived === 'boolean') return st.archived;
    if (typeof st.active === 'boolean') return !st.active;
  }
  if (typeof v?.archived === 'boolean') return v.archived;
  return false;
}
