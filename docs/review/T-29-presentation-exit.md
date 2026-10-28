# T-29 — `presentation`: `exitCode` вместо `process.exit` и без commander-легаси

- **Приоритет:** **P1** — в меню `process.exit` убивает процесс (R2 в [`REVIEW.md`](../../REVIEW.md))
- **Этап:** 11
- **Зависимости:** нет (правка только `presentation`)
- **Объём:** 2 файла команд, 1 тест-смоук меню
- **Пути:** актуальны на 2026-10-28
- **Статус:** ✅ сделано (`fa48c17`, `9e23a14`); TTY-smoke меню — за пользователем

## Проблема

1. `src/presentation/cli/commands/cmd-resume.ts:47,51,61,65` — `process.exit(1)` в ветках ошибок
   (`missing-name`, `not-found`, `error`). Команда вызывается из меню
   (`presentation/cli/menu/steps.ts:129,135`), поэтому процесс завершается целиком: не отрабатывает
   `finally` в `run()` (`presentation/cli/index.ts:44-53`), не закрывается SQLite (`closeResources()`),
   пользователь вылетает из приложения. Остальные команды уже используют `process.exitCode`
   (`cmd-digest.ts:43`, `cmd-schedule.ts:40,45`, `presentation/cli/index.ts:36,49`).
2. `cmd-resume.ts:88-89` — `opts: Record<string, any>` и `opts._?.join(' ')`: интерфейс от времён
   подкоманд commander; меню передаёт `{ _: ["list"] }` / `{ _: [action, name] }`, хотя подкоманд
   в CLI больше нет.
3. `cmd-resume.ts:14` — английская строка «No resumes found. Set RESUMES_DIR or RESUME_PATH.»
   в остальном русском CLI.
4. `src/presentation/cli/commands/cmd-digest.ts:27-28,30-35,40` — недостижимые ветки: `cmdDigest({...})`
   = show (все вызовы передают строку: `menu.ts:93`, `steps.ts:53,62,73`) и алиасы
   `make/create/last/latest/view`; параметр объявлен как `action: any`.

## Что сделать

- [x] `cmd-resume`: `process.exitCode = 1` + `return`; подпись `cmdResume(opts: { action?: 'list' | 'register' | 'show'; name?: string })`.
- [x] Меню (`presentation/cli/menu/steps.ts:129,135`) передаёт `{ action, name }` вместо `{ _: [...] }`.
- [x] Русский текст вместо английского в `cmd-resume.ts:14`.
- [x] `cmd-digest`: убрать ветку-объект, алиасы и `any`; оставить `action: 'build' | 'show' | 'actualize'`.
- [ ] Ручной smoke: пункт меню «🧾 Резюме» → `show` с несуществующим именем — печатает ошибку,
      меню остаётся живым; `list` работает. _(нужен TTY: не выполнялось; вместо него спек
      `tests/cmd-resume.spec.ts` — при возврате `process.exit` процесс тестов падает)_

## Definition of Done

- [x] `Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'process\.exit\(1\)'` → пусто.
- [x] `npx tsc --noEmit` → exit 0; `node bin/auto-hh --help` → exit 0.
- [x] Тексты меню и команды `resume` не изменились (кроме перевода одной строки).

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'process\.exit\(1\)'
node bin/auto-hh --version
node bin/auto-hh --help
```

## Риски

- `process.exitCode` в интерактивном меню означает «код возврата после выхода», а не немедленный
  выход: именно это и нужно, но после ошибки меню продолжает работу — так уже ведут себя `digest`
  и `schedule`.
- Живой прогон меню требует TTY — проверка ручная, в отчёте указывается отдельно.
