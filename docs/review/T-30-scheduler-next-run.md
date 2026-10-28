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

- [ ] `Scheduler` (`domain/ports.ts`): добавить `nextRun(expression: string): Date | null`
      (или `schedule(): { nextRun(): Date | null }` — решить по месту вызова).
- [ ] `NodeCronScheduler`: реализовать через `cron.schedule(...).getNextRun()` / `cron.validate`,
      задачу сохранять в поле, чтобы её можно было останавливать.
- [ ] `application/schedule.ts:68,91`: один расчёт next run; при `null` — прежнее поведение
      («неизвестно» в `presentation/cli/commands/cmd-schedule.ts:49`).
- [ ] Удалить `src/shared/cron.ts` и его импорт.
- [ ] Тест на фейковом `Scheduler` (`tests/schedule-next-run.spec.ts`): next run приходит из порта,
      `null` не ломает запуск, `no-cron`/`invalid-cron` не изменились.

## Definition of Done

- [ ] `npx tsc --noEmit` → exit 0; `npm run arch` → 0 нарушений; `npm run test:types` → exit 0.
- [ ] `Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'getNextDate|shared/cron'` → пусто.
- [ ] `node bin/auto-hh --help` → exit 0.
- [ ] Текст «Следующий запуск» и формат `toLocaleString("ru-RU")` сохранены.

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
