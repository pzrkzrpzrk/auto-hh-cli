import log from "./logger.js";

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;
const JITTER_RATIO = 0.25;

interface RetryOpts {
  attempts?: number;
  /** Базовая пауза экспоненциального backoff (мс). */
  baseDelayMs?: number;
  /** Потолок паузы (мс), включая Retry-After. */
  maxDelayMs?: number;
  // Метка для лога: у параллельных запросов сообщения иначе не различить.
  label?: string;
}

// Разброс в паузах нужен, чтобы параллельные запросы не повторяли синхронно:
// иначе все ждут одинаковые 1, 2, 4 с и снова получают 429 одним залпом.
function jitter(ms: number): number {
  return Math.round(ms * (1 - JITTER_RATIO + Math.random() * JITTER_RATIO));
}

// Повторяем только то, что имеет смысл повторять: лимиты (429), таймауты и 5xx.
// На 400/401/404 (неверный запрос, ключ, модель) повтор бесполезен — сразу наверх.
// SDK-ошибки распознаём по имени, чтобы shared не импортировал openai.
function isTransient(err: any): boolean {
  if (err?.name === 'APIConnectionError' || err?.name === 'APIConnectionTimeoutError') return true;

  const status = typeof err?.status === 'number' ? err.status : null;
  if (status !== null) return status === 408 || status === 409 || status === 429 || status >= 500;

  const message = String(err?.message || '');
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network|timeout/i.test(message);
}

// Сервер может сам сказать, через сколько секунд повторить (Retry-After).
function retryAfterMs(err: any, maxDelayMs: number): number | null {
  const headers = err?.headers;
  if (!headers) return null;
  const raw = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  if (raw === undefined || raw === null) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, maxDelayMs);
}

async function retryOnTransient<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const requested = opts.attempts ?? DEFAULT_ATTEMPTS;
  const attempts = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const where = opts.label ? ` ${opts.label}` : '';
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt >= attempts - 1;
      if (isLast || !isTransient(err)) throw err;
      const backoff = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      // Retry-After от сервера уважаем как есть, иначе добавляем разброс.
      const delay = retryAfterMs(err, maxDelayMs) ?? jitter(backoff);
      log.warn(`AI retry${where} ${attempt + 1}/${attempts - 1} in ${delay}ms: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export { retryOnTransient };
export type { RetryOpts };
