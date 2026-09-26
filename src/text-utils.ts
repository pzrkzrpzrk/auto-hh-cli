// Общие текстовые утилиты: очистка HTML и разбор ответов модели.
import log from "./logger.js";

export function stripHtml(s: string): string {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const PREVIEW_LIMIT = 200;

function preview(text: string): string {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_LIMIT ? `${oneLine.slice(0, PREVIEW_LIMIT)}…` : oneLine;
}

// Снимает markdown-обёртку вокруг JSON: ```json … ```, ``` … ```, ** … **.
function stripMarkup(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.replace(/^\*\*+/, '').replace(/\*\*+$/, '');
  return cleaned.trim();
}

// Срез по границам JSON-объекта: от первой `{` до последней `}`.
// Нужен, когда модель добавила преамбулу/эпилог вокруг JSON.
function braceSlice(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}

// Мягкая правка «почти JSON»: эвристика по незаэкранированным кавычкам внутри значений
// (дословно из прежнего safeJsonParse; на практике p1 не может содержать `"` из-за `[^"]*`,
// поэтому эффект даёт вторая замена — control-символы на пробел) + сам санитайз control-символов.
// Порядок повторяет прежний код: сначала кавычки, затем control-символы.
function sanitize(text: string): string {
  const quoted = text.replace(
    /: "([^"]*?)"([^,\]}])/g,
    (_m, p1: string, p2: string) => `: "${p1.replace(/"/g, '«')}"${p2}`
  );
  return quoted.replace(/[\x00-\x1f]/g, ' ');
}

/**
 * Разбирает ответ модели как JSON.
 *
 * Стратегии применяются последовательно, первая успешная выигрывает:
 * 1) `JSON.parse` как есть;
 * 2) снятие markdown-обёртки (фенсы, `**`);
 * 3) срез по границам `{…}`;
 * 4) санитайз: незаэкранированные кавычки и управляющие символы.
 *
 * Контракт: **бросает** `Error`, если ни одна стратегия не сработала, и перед этим ровно один раз
 * пишет `log.warn` с причиной и превью ответа. Что делать с ошибкой (вернуть `null`, пустой
 * результат, пробросить дальше) решает вызывающий. Для безопасного доставания массива из
 * результата есть `asList` — она не бросает.
 */
export function parseJSON<T = any>(raw: string): T {
  if (typeof raw !== 'string' || !raw.trim()) {
    log.warn('parseJSON: пустой ответ модели');
    throw new Error('parseJSON: empty input');
  }

  const stripped = stripMarkup(raw);
  const sanitized = sanitize(stripped);
  const candidates: string[] = [];
  for (const candidate of [raw, stripped, braceSlice(raw), braceSlice(stripped), sanitized, braceSlice(sanitized)]) {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }

  let lastErr: any = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (err) {
      lastErr = err;
    }
  }

  log.warn(`parseJSON: не удалось разобрать ответ модели (${lastErr?.message}); ответ: ${preview(raw)}`);
  throw new Error(`parseJSON: ${lastErr?.message || 'invalid JSON'}`);
}

/**
 * Достаёт список из результата разбора: сам массив как есть либо `parsed[key]`, если это массив.
 *
 * Контракт: **не бросает**. Любое другое значение (`null`, `undefined`, объект без нужного
 * массива, скаляр) даёт `[]` — так вызывающий код обходится без `parsed.x || []`.
 */
export function asList<T = any>(parsed: unknown, key?: string): T[] {
  if (Array.isArray(parsed)) return parsed as T[];
  if (key && parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}
