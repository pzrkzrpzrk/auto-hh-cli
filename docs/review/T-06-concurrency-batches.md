# T-06 — Единый пул воркеров «пачки + concurrency»

- **Приоритет:** P1 — REVIEW.md § I **D4**
- **Этап:** 1
- **Зависимости:** T-04 (единый `intFromEnv` для `CONCURRENCY`/размеров пачек)
- **Объём:** 1 новый модуль + 2 реализации

## Проблема

Два почти одинаковых пула воркеров:

- `src/cli/cmd-digest.ts:57-113` — `judgeWithClaude`;
- `src/domain/cover-letter/cover-letter.ts:121-193` — `buildCoverLettersBatch`.

Общий каркас полностью совпадает: `chunk` → общий `nextBatchIdx` → `worker()` →
`Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, ...))`,
`try/catch` на пачку и печать прогресса. Различия — только в теле обработки одной пачки.
Риск: правки (например, backoff при 429 или отмена по Ctrl+C) применяются по одному месту и расходятся.

## Что сделать

- [ ] Новый `src/concurrency.ts`:
      - `chunk<T>(items: T[], size: number): T[][]`;
      - `runBatches<T, R>(batches: T[][], concurrency: number, fn: (batch: T[], i: number) => Promise<R>,
        opts?: { onBatch?, onError? }): Promise<R[]>` — сохранить текущий контракт ошибок (`onError`
        по умолчанию логирует и продолжает, как сейчас в обоих местах).
- [ ] `cmd-digest.ts`: `judgeWithClaude` → вызов `runBatches`, оставить только тело обработки пачки.
- [ ] `cover-letter.ts`: `buildCoverLettersBatch` → то же.
- [ ] `CONCURRENCY` и размеры пачек читать через `intFromEnv` из T-04 (не дублировать `parseInt`).
- [ ] Один и тот же `log` прогресса («пачка X из Y») в обоих шагах — сейчас формулировки разные.

## Definition of Done

- [ ] В кодовой базе один экземпляр конструкции `nextBatchIdx`/`Array.from({ length: Math.min(...`.
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] Порядок вызовов ИИ и число параллельных запросов не изменились (проверить по логам прогона
      `digest build` и `cover` — количество и размер пачек те же).

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src -Recurse -Include *.ts | Select-String -Pattern 'nextBatchIdx|Math\.min\(CONCURRENCY'
```

## Риски

Пул воркеров — место, где легко получить «голодную» или наоборот лавинообразную нагрузку на API. Поэтому
`runBatches` обязан запускать **ровно** `Math.min(concurrency, batches.length)` воркеров и не создавать новых
до завершения предыдущего (как сейчас). Явно покрыть это в JSDoc и не «оптимизировать» на `Promise.all(batches)`,
иначе шаг с 1000 вакансий разом уйдёт в API.

Отдельно: если в `runBatches` добавится обработка ошибок, **не** менять текущее поведение
`cover-letter.ts` (`onBatch` получает накопленный результат) до выполнения T-09, иначе письма перестанут
попадать в `coverDigest`. Порядок правок: сначала T-06 (механика), потом T-09 (контракт `onBatch`).
