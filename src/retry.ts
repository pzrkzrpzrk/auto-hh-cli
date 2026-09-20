import OpenAI from "openai";
import log from "./logger.js";

const DEFAULT_ATTEMPTS = 5;
const BASE_DELAY_MS = parseInt(process.env.AI_RETRY_BASE_MS || '1000', 10);
const MAX_DELAY_MS = parseInt(process.env.AI_RETRY_MAX_MS || '30000', 10);

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

async function retryOnTransient(fn: () => Promise<unknown>, maxAttempts = DEFAULT_ATTEMPTS) {
  const attempts = Math.max(1, maxAttempts);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt >= attempts - 1;
      if (isLast || !isTransient(err)) throw err;
      const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      const delay = retryAfterMs(err) ?? backoff;
      log.warn(`AI retry ${attempt + 1}/${attempts - 1} in ${delay}ms: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export { retryOnTransient };
