import OpenAI from "openai";
import log from "./logger.js";

const ENV_ATTEMPTS = parseInt(process.env.AI_RETRY_ATTEMPTS || '', 10);
const ENV_BASE = parseInt(process.env.AI_RETRY_BASE_MS || '', 10);
const ENV_MAX = parseInt(process.env.AI_RETRY_MAX_MS || '', 10);

const DEFAULT_ATTEMPTS = Number.isFinite(ENV_ATTEMPTS) && ENV_ATTEMPTS > 0 ? ENV_ATTEMPTS : 5;
const BASE_DELAY_MS = Number.isFinite(ENV_BASE) && ENV_BASE > 0 ? ENV_BASE : 1000;
const MAX_DELAY_MS = Number.isFinite(ENV_MAX) && ENV_MAX > 0 ? ENV_MAX : 30000;
const JITTER_RATIO = 0.25;

interface RetryOpts {
  attempts?: number;
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
function isTransient(err: any): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true;

  const status = typeof err?.status === 'number' ? err.status : null;
  if (status !== null) return status === 408 || status === 409 || status === 429 || status >= 500;

  const message = String(err?.message || '');
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network|timeout/i.test(message);
}

// Сервер может сам сказать, через сколько секунд повторить (Retry-After).
function retryAfterMs(err: any): number | null {
  const headers = err?.headers;
  if (!headers) return null;
  const raw = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  if (raw === undefined || raw === null) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_DELAY_MS);
}

async function retryOnTransient<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const requested = opts.attempts ?? DEFAULT_ATTEMPTS;
  const attempts = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_ATTEMPTS;
  const where = opts.label ? ` ${opts.label}` : '';
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt >= attempts - 1;
      if (isLast || !isTransient(err)) throw err;
      const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      // Retry-After от сервера уважаем как есть, иначе добавляем разброс.
      const delay = retryAfterMs(err) ?? jitter(backoff);
      log.warn(`AI retry${where} ${attempt + 1}/${attempts - 1} in ${delay}ms: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export { retryOnTransient };
export type { RetryOpts };
