# T-30 — `Scheduler.nextRun()` вместо самописного cron

- **Приоритет:** **P2** — корректность подсказки «следующий запуск» (R6 в [`REVIEW.md`](../../REVIEW.md))
- **Этап:** 11
- **Зависимости:** T-22 (порт `Scheduler`), T-26 (фейковый планировщик в тестах)
- **Объём:** порт `Scheduler`, адаптер `node-cron`, `application/schedule.ts`, удаление `shared/cron.ts`
- **Пути:** актуальны на 2026-10-28

## Проблема

`src/shared/cron.ts:1-42` — собственный парсер: перебор минут на 48 часов вперёд с поддержкой
`*`, `*/n`, `a-b`, `a,b`. Он не понимает `a-b/n` и `?`, не знает имён месяцев и дней недели,
а `day-of-week` сравнивает с `Date.getDay()` (0 = воскресенье), тогда как в cron воскресенье — это
и `0`, и `7`.

При этом `node-cron@4.2.1` уже в зависимостях и умеет `getNextRun()`, но порт
`Scheduler` (`domain/ports.ts:22-27`) отдаёт только `validate`/`schedule`, поэтому адаптер
`infrastructure/scheduling/node-cron.ts` создаёт задачу «в никуда» и расчёт next run не пробрасывает.
`application/schedule.ts:68` и `:91` дополнительно считают его дважды — до и после регистрации задачи.

## Что сделать

- [x] `Scheduler` (`domain/ports.ts`): добавлен `nextRun(expression: string): Date | null` —
      расчёт отдан адаптеру, сценарий не разбирает cron.
- [x] `NodeCronScheduler`: задача хранится в поле (`schedule` останавливает предыдущую),
      `nextRun` берёт `getNextRun()` у стоящей задачи, а для чужого выражения — у временной,
      которую сразу останавливает.
- [x] `application/schedule.ts`: один расчёт next run на постановку (`nextRun` после `schedule`),
      в срабатывании — ещё один для события `next-run`; при `null` — прежнее «неизвестно»
      в `presentation/cli/commands/cmd-schedule.ts:49`.
- [x] Удалён `src/shared/cron.ts` и его импорт.
- [x] Тест на фейковом `Scheduler` (`tests/schedule-next-run.spec.ts`): next run приходит из порта,
      `null` не ломает запуск, `no-cron`/`invalid-cron` не изменились, событие `next-run` — из порта.

## Definition of Done

- [x] `npx tsc --noEmit` → exit 0; `npm run arch` → 0 нарушений (188 модулей, 701 зависимость);
      `npm run test:types` → exit 0.
- [x] `Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'getNextDate|shared/cron'` → пусто.
- [x] `node bin/auto-hh --help` → exit 0.
- [x] Текст «Следующий запуск» и формат `toLocaleString("ru-RU")` сохранены (правок в
      `cmd-schedule.ts` нет).
- [x] Адаптер проверен на живой библиотеке: `cron.schedule('*/5 * * * *').getNextRun()` возвращает
      дату, `cron.validate('bad')` → `false`.

## Проверка

```powershell
npx tsc --noEmit
npm run arch
npx vitest run tests/schedule-next-run.spec.ts --reporter=dot
Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'getNextDate|shared/cron'
```

## Риски

- `getNextRun()` считает в локальной таймзоне, а прежний перебор — тоже локально, так что формат
  вывода не меняется. Проверять на выражении с `*/n` и диапазоном.
- Реальный запуск по расписанию не проверяется (ждёт минуты/часы); замена — фейковый `Scheduler`.
