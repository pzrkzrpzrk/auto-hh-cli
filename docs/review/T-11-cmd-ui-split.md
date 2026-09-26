# T-11 — `cmd-ui.ts`: распил на модули и общий выбор резюме

- **Приоритет:** P1 — REVIEW.md § II **K1** (+ § I **D8**, P2)
- **Этап:** 4
- **Зависимости:** нет (но делать после T-04 — иначе перенос кода дважды затронет одни файлы)
- **Объём:** 413 строк → 4 модуля

## Проблема

`src/cli/cmd-ui.ts` — 413 строк с 10+ обязанностями в одном файле:

| Что | Строки |
|---|---|
| Сборка опций поиска/дайджеста/писем/отклика | `buildSearchOptions` :56, `buildDigestOptions` :61, `buildCoverOptions` :77, `buildApplyOptions` :84 |
| Описание окружения (что настроено / чего нет) | `describeEnvResume` :91, `describeActiveResume` :104 |
| Выбор резюме | `pickResume` :113, `runPickActiveResume` :142, `askResumeName` :181 |
| Счётчики (сколько чего в базе) | `askCount` :197 |
| Шаги меню | :206-319 (9 функций: search, digest, letters, apply, resume, grade, cover, schedule, reset) |
| Список пунктов меню | :325-341 |
| Меню и диспетчеризация | `mainMenu` :320, `dispatch` :346, `cmdUi` :373 |
| Обработка Ctrl+C и `exitCode` | :400 |

Плюс **D8** — список резюме для выбора собирается дважды: `:113-141` (`pickResume`) и `:142-180`
(`runPickActiveResume`) с одинаковыми `choices` и пометкой активного/незарегистрированного.

## Что сделать

- [ ] Разнести по модулям (имена по слою, как принято в проекте):
      - `src/cli/ui/options.ts` — 4 функции сборки опций;
      - `src/cli/ui/resume.ts` — `resumeChoices({ markLabel })` + `pickResume` / `runPickActiveResume` на его основе;
      - `src/cli/ui/steps.ts` — 9 функций-шагов меню (`runSearch`, `runDigest`, `runLetters`, `runApply`,
        `runResumeMenu`, `runGrade`, `runCover`, `runSchedule`, `runReset`) и счётчики;
      - `src/cli/ui/menu.ts` — `mainMenu`, `dispatch`, `cmdUi`, обработка Ctrl+C.
- [ ] `src/cli/cmd-ui.ts` оставить тонким реэкспортом (`export { default } from './ui/menu.js'`), чтобы
      `src/cli/index.ts:13` (`import cmdUi from "./cmd-ui.js"`) не менялся в этом коммите.
- [ ] **D8:** `resumeChoices` — единственное место построения `choices` (пометки активного и
      незарегистрированного, значения — пути к файлам).
- [ ] Соблюсти: `process.exitCode = 1` на `:400` — единственный выход; никаких `process.exit` (см. T-03).

## Definition of Done

- [ ] Ни один новый файл не превышает ~150 строк; `cmd-ui.ts` — не более ~10 строк.
- [ ] Диалоги меню **побайтово** те же: тексты пунктов, подсказки, порядок, значения по умолчанию.
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] `npx tsx bin/auto-hh ui`: проход по всем 8 шагам, включая отмену (Ctrl+C) на каждом промпте —
      процесс завершается без ошибок, `closeDb()` отрабатывает.

## Проверка

```powershell
npx tsc --noEmit
npx tsx bin/auto-hh ui
(Get-ChildItem src\cli\ui -Filter *.ts | ForEach-Object { "$($_.Name): $((Get-Content $_.FullName).Count)" })
```

## Риски

- `mainMenu`/`dispatch` завязаны на замыкания и общий контекст (выбранное резюме, клиент, кэш). При переносе
  передавать контекст явным параметром (`ctx`), а не через модульные переменные — иначе получится тот же
  «бог», только размазанный по файлам.
- Циклических импортов не создавать: `ui/steps.ts` может зависеть от `cmd-*` модулей, но `ui/menu.ts` —
  только от `ui/*`.
- Порядок шагов и подписи — часть UX; любые изменения текстов считать регрессом этого тикета.
