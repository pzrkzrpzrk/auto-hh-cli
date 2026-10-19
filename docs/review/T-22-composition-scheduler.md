# T-22 — Единый composition root и порт `Scheduler` вместо `node-cron`

- **Приоритет:** **P1** — фреймворк в слое сценариев + частичная сборка зависимостей
- **Этап:** 9
- **Зависимости:** T-17, T-18, T-20 (после них у сценариев появляются deps-объекты)
- **Объём:** `composition.ts`, `application/schedule.ts`, новый адаптер, 4 команды
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

### 1. Фреймворк в use case

`application/schedule.ts:3` — `import cron from "node-cron"`, и дальше `cron.validate` / `cron.schedule`.
Сценарий зависит от библиотеки планировщика, то есть «фреймворк — не деталь».

### 2. Composition root не единственный

`composition.ts` собирает `searchDeps`, `digestDeps`, `digestShowDeps`, `actualizeDeps`, `coverDeps`
(после T-17 — ещё `applyDeps`). Но:

- `application/grade.ts:3`, `schedule.ts:4` импортируют адаптеры сами (`grade` — чтение резюме,
  `schedule` — конфиг; `history`/`resume`/`resume-download` закрыты T-20);
- `presentation/cli/index.ts:7` импортирует `closeDb` из `infrastructure/mongo/db`;
- `presentation/cli/commands/cmd-config.ts:2` — `loadConfig`;
- `presentation/cli/menu/resume.ts:4`, `menu/resume-download.ts:7` — `resume-loader`.

Итого: оставшиеся модульные импорты инфраструктуры в `application` (`grade`, `schedule`, чтение
конфига в сценариях) + 4 в `presentation` обходят точку сборки.

## Что сделать

- [ ] `domain/ports.ts`: `Scheduler { validate(expr): boolean; schedule(expr, fn): void }`.
- [ ] `infrastructure/scheduling/node-cron.ts`: адаптер (единственный `import cron` в проекте).
- [ ] `application/schedule.ts`: принимает `scheduler` через `ScheduleDeps`; `getNextDate` остаётся
      в `shared/cron` (чистая функция).
- [ ] `composition.ts`: `scheduleDeps`, `historyDeps`, `resumeDeps`, `resetDeps`, `gradeDeps`;
      экспорт `closeResources()` вместо прямого `closeDb` в CLI (или проброс через `run(argv, { onExit })`).
- [ ] `cmd-config` → `application/config-view.ts` (сценарий «покажи конфиг»), `menu/resume*` →
      `application/resume.ts`.
- [ ] `presentation` импортирует только `application/*` и `composition.js`.

## Definition of Done

- [ ] `Select-String -Path src\application -Pattern 'node-cron|infrastructure/'` → пусто.
- [ ] `Select-String -Path src\presentation -Pattern 'infrastructure/'` → пусто.
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] `schedule` ведёт себя как раньше: те же сообщения, тот же порядок шагов,
      `no-cron`/`invalid-cron` → `exitCode = 1`, следующий запуск считается так же.

## Проверка

```powershell
npx tsc --noEmit
Select-String -Path src -Pattern 'from "node-cron"'
Select-String -Path src\presentation -Pattern 'infrastructure'
npx tsx bin/auto-hh ui   # «Планировщик» → проводка та же, первый прогон по cron
```

## Риски

- `node-cron@4` — единственная версия в проекте; адаптер должен вызывать `cron.schedule` с той же
  сигнатурой (async-колбэк), иначе изменится обработка ошибок шагов.
- `closeDb` в `finally` — гарантия завершения процесса; при переносе в `composition.closeResources()`
  проверить, что монитор Mongo закрывается и в ветке ошибки.
