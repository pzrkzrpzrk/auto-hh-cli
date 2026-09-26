// Единый пул воркеров для пачек ИИ-запросов.
// До этого `chunk` + общий счётчик `nextBatchIdx` + `Promise.all(Array.from({ length:
// Math.min(CONCURRENCY, …) }))` были скопированы в cli/cmd-digest.ts (judgeWithClaude)
// и domain/cover-letter/cover-letter.ts (buildCoverLettersBatch), и правки расходились.
import log from "./logger.js";
import { intFromEnv } from "./env.js";

/** Режет список на пачки по `size` элементов. `size < 1` поднимается до 1. */
export function chunk<T>(items: T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size) || 1);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

/** Параллелизм пула: env `CONCURRENCY` (>= 1), иначе `def` (10). */
export function concurrencyFromEnv(def = 10): number {
  return intFromEnv('CONCURRENCY', def, { min: 1 });
}

export interface RunBatchesOpts<T, R> {
  /** Вызывается после успешной обработки пачки — с её результатом и индексом (0-based). */
  onBatch?: (result: R, batch: T[], index: number) => void | Promise<void>;
  /** Вызывается при ошибке `fn` или `onBatch`; по умолчанию — `log.warn` и продолжение. */
  onError?: (err: any, batch: T[], index: number) => void | Promise<void>;
}

/**
 * Пул воркеров для пачек: запускает **ровно** `Math.min(concurrency, batches.length)`
 * воркеров, и каждый берёт следующую пачку из общего счётчика только после завершения
 * предыдущей — то есть одновременно выполняется не больше `concurrency` вызовов `fn`.
 *
 * НЕ «оптимизировать» на `Promise.all(batches.map(fn))`: при тысяче пачек это разом уйдёт
 * в API. Счётчик инкрементируется синхронно (до `await fn`), поэтому пачки не теряются
 * и не дублируются, а порядок старта пачек остаётся исходным.
 *
 * Ошибка одной пачки не роняет прогон: по умолчанию логируется `log.warn`, обработка
 * остальных пачек продолжается (можно переопределить через `opts.onError`).
 *
 * @param batches пачки для обработки (обычно результат `chunk`).
 * @param concurrency максимум одновременных вызовов `fn` (значения < 1 поднимаются до 1).
 * @param fn обработчик пачки: `(batch, index)`, где `index` — индекс пачки (0-based).
 * @param opts `onBatch` (после успешной пачки) и `onError` (по умолчанию `log.warn`).
 * @returns результаты в порядке пачек; у упавшей пачки — `undefined`.
 */
export async function runBatches<T, R>(
  batches: T[][],
  concurrency: number,
  fn: (batch: T[], index: number) => Promise<R>,
  opts: RunBatchesOpts<T, R> = {},
): Promise<R[]> {
  const total = batches.length;
  const results = new Array<R>(total);
  if (!total) return results;

  const handleError = async (err: any, batch: T[], index: number) => {
    if (opts.onError) {
      await opts.onError(err, batch, index);
      return;
    }
    log.warn(`Batch ${index + 1}/${total} failed (${batch.length} items): ${err?.message ?? err}`);
  };

  let nextBatchIdx = 0;

  async function worker() {
    while (nextBatchIdx < total) {
      const index = nextBatchIdx;
      nextBatchIdx++;
      const batch = batches[index];
      // Единый лог прогресса для всех ИИ-шагов: «пачка X из Y».
      log.info(`Batch ${index + 1}/${total}: ${batch.length} items`);
      let value: R;
      try {
        value = await fn(batch, index);
      } catch (err) {
        await handleError(err, batch, index);
        continue;
      }
      results[index] = value;
      if (opts.onBatch) {
        try {
          await opts.onBatch(value, batch, index);
        } catch (err) {
          await handleError(err, batch, index);
        }
      }
    }
  }

  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, total));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  return results;
}
