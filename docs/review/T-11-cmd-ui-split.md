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

- [x] Разнести по модулям (имена по слою, как принято в проекте):
      - `src/cli/ui/options.ts` — 4 функции сборки опций;
      - `src/cli/ui/resume.ts` — `resumeChoices({ markLabel })` + `pickResume` / `runPickActiveResume` на его основе;
      - `src/cli/ui/steps.ts` — 9 функций-шагов меню (`runSearch`, `runDigest`, `runLetters`, `runApply`,
        `runResumeMenu`, `runGrade`, `runCover`, `runSchedule`, `runReset`) и счётчики;
      - `src/cli/ui/menu.ts` — `mainMenu`, `dispatch`, `cmdUi`, обработка Ctrl+C.
- [x] `src/cli/cmd-ui.ts` оставить тонким реэкспортом (`export { default } from './ui/menu.js'`), чтобы
      `src/cli/index.ts:13` (`import cmdUi from "./cmd-ui.js"`) не менялся в этом коммите.
- [x] **D8:** `resumeChoices` — единственное место построения `choices` (пометки активного и
      незарегистрированного, значения — пути к файлам).
- [x] Соблюсти: `process.exitCode = 1` на `:400` — единственный выход; никаких `process.exit` (см. T-03).

## Definition of Done

- [x] Ни один новый файл не превышает ~150 строк (`menu.ts` 146, `resume.ts` 139, `steps.ts` 137,
      `options.ts` 37); `cmd-ui.ts` — 3 строки.
- [x] Диалоги меню **побайтово** те же: тексты пунктов, подсказки, порядок, значения по умолчанию
      (сверка всех строковых литералов со старым файлом + прогон с подменёнными промптами, см. «Проверки»).
- [x] `npx tsc --noEmit` → exit 0.
- [ ] `npx tsx bin/auto-hh ui`: проход по всем 8 шагам, включая отмену (Ctrl+C) на каждом промпте —
      в этом окружении нет TTY. Вместо живого прогона сделан e2e с подменёнными промптами (все 13 пунктов
      меню и отказы) и прогон `bin/auto-hh ui` без TTY; живой проход по меню — за владельцем.

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

## Реализовано

1. `src/cli/ui/options.ts` — `buildSearchOptions` / `buildDigestOptions` / `buildCoverOptions` /
   `buildApplyOptions` перенесены как есть (только «ответы → параметры команды», без ввода-вывода).
2. `src/cli/ui/resume.ts` — состояние сессии резюме и единый список `choices`:
   `describeEnvResume(ctx)` / `describeActiveResume(ctx)` (подпись .env кэшируется в `ctx.envResumeLabel`),
   `resumeChoices(files, { active, envLabel, markLabel, manual })` (D8 — единственное место сборки списка),
   `pickResume(ctx, message)` / `runPickActiveResume(ctx)` / `askResumeName(message)`.
3. `src/cli/ui/steps.ts` — 9 шагов меню (`runSearch`, `runDigest(ctx)`, `runLetters(ctx)`, `runApply`,
   `runResumeMenu(ctx)`, `runGrade(ctx)`, `runCover(ctx)`, `runSchedule(ctx)`, `runReset`) и `askCount`.
   Шаги только собирают ответы и вызывают `cmd-*`; `ctx` передаётся явным параметром.
4. `src/cli/ui/menu.ts` — `MenuItem`, список из 13 пунктов и трёх `Separator` (в `mainMenu`), `dispatch(ctx, item)`,
   `cmdUi()`: проверка TTY, шапка, цикл «меню → шаг», `try/catch` подменю, обработка `ExitPromptError`,
   единственный `process.exitCode = 1`, возврат stdin из raw-режима.
5. `src/cli/cmd-ui.ts` — тонкая обёртка: комментарий + `export { default } from "./ui/menu.js";`
   (3 строки). `src/cli/index.ts` не менялся: он по-прежнему импортирует `./cmd-ui.js`.
6. `README.md` — в дереве `src/cli/` появился блок `ui/` (4 модуля) с описанием.

## Отступления

1. `pickResume` больше не принимает `allowDefault`: во всех четырёх вызовах параметр был `true`
   (то есть ветка без пункта «как в .env» была мёртвой), поэтому он убран — поведение вызовов не изменилось.
2. Вместо модульных переменных `activeResume` / `envResumeLabel` — явный `ctx: UiContext`, создаётся в `cmdUi()`
   и передаётся в шаги (как требует раздел «Риски» тикета). Побочный эффект: `describeActiveResume` теперь
   требует `ctx`, а не берёт состояние из модуля.
3. Именованные экспорты старого `cmd-ui.ts` (`isPromptCancelled`, `isInteractive`, `buildSearchOptions`,
   `buildDigestOptions`, `buildCoverOptions`, `buildApplyOptions`, `describeActiveResume`) не реэкспортируются:
   внешних потребителей нет (grep по `src/`, `bin/`, `app.ts` — используется только `default` в `cli/index.ts:14`).
   Функции живут в `ui/options.ts` / `ui/resume.ts`, а `isPromptCancelled` и `isInteractive` сделаны локальными
   для `ui/menu.ts` (нужны только там).
4. `resumeChoices` параметризован под два прежних места: `markLabel` («← активное» и «← сейчас») и
   `manual: "auto" | "always"` (в `pickResume` ручной ввод — только при пустом `RESUMES_DIR`,
   в «выбрать активное» — всегда). Значение по умолчанию считается прежней формулой
   «активное, если оно есть в списке, иначе первый пункт»: в обоих местах первый пункт — «как в .env»,
   поэтому `default` совпал побайтово.
5. Список пунктов меню, `pageSize: 15` и порядок `Separator` оставлены в `mainMenu` как были (без выноса
   в отдельную константу) — минимум изменений в UX-текстах.
6. `askCount` перенесён в `ui/steps.ts` (используется только шагами меню), `DEFAULT_RESUME` / `MANUAL_RESUME` —
   в `ui/resume.ts` (это детали выбора резюме).
7. Обработка ошибок меню оставлена дословно: ошибка подменю печатается в `console.error` и цикл продолжается,
   Ctrl+C (`ExitPromptError`) выходит без печати «Пока!» и без изменения `exitCode`.
8. Модульных переменных в `ui/*` не осталось: `ui/options.ts` и `ui/steps.ts` — функции без состояния,
   единственное изменяемое состояние — `ctx` (активное резюме сессии и кэш подписи .env).
9. Строка `if (isPromptCancelled(err)) throw err;` перенесена дословно (в прежнем файле — `cmd-ui.ts:393`),
   поэтому IDE так же помечает её подсказкой «'throw' of exception caught locally» (`menu.ts:126`). Переписывать
   на `return` из внутреннего `catch` не стали: наблюдаемое поведение то же, но это уже правка логики выхода,
   а цель тикета — распил без изменения поведения.

## Проверки

- `npx tsc --noEmit` → exit 0; строки файлов: `menu.ts` 146, `resume.ts` 139, `steps.ts` 137, `options.ts` 37,
  `cmd-ui.ts` 3.
- Сверка диалоговых текстов с прежним файлом (`git show HEAD:src/cli/cmd-ui.ts`): извлечены все строковые
  литералы с кириллицей/эмодзи — 55 (старый, с дублями) против 54 (новые файлы); множества строк совпадают
  полностью, единственное различие по частоте — «ввести имя резюме вручную» 2 → 1 (ровно D8).
- Самопроверка `data/tmp-t11-selfcheck.ts` (tsx, промпты `@inquirer/prompts` и `cmd-*` подменены заглушками
  через `Module._load`; после прогона файл удалён): **58 OK / 0 FAIL**
  - реэкспорт `cmd-ui.ts` → `ui/menu.ts`; `ui/steps.ts` экспортирует 9 шагов;
  - без TTY: точный текст подсказки, промпты не вызываются;
  - шапка меню / «Ctrl+C — выход» / строка «Резюме: …» / «Пока!» — побайтово;
  - список из 13 пунктов и 3 разделителей: порядок, тексты, значения, `message`, `pageSize: 15`;
  - диспетчеризация всех 13 пунктов (login/config/search/reset/digestShow/history/digest/letters/apply/
    cover/grade/schedule/resume) — какой модуль и с какими opts вызывается, включая `json`, `force`, `limit`
    (0 → без `limit`), `trim()` у id вакансии;
  - `resume`-подменю: list / show / back / pick, тексты пунктов и `cmdResume({ _: [...] })`;
  - активное резюме: сохраняется в `ctx` и печатается на следующей итерации меню; «как в .env» сбрасывает его;
  - ошибка подменю: `Ошибка: boom` и меню продолжается; Ctrl+C на меню и внутри подменю: без «Пока!» и без
    «Ошибка», `process.exitCode` не меняется;
  - `build*Options` — 8 кейсов; `resumeChoices` — 5 кейсов (порядок, пометки, `defaultValue`, ручной ввод,
    пустой `RESUMES_DIR`); `describe*` и кэш подписи в `ctx`; `pickResume` — 3 ветки ответа.
- `node bin/auto-hh --help` → exit 0, `node bin/auto-hh ui` (без TTY) → exit 0 с текстом подсказки,
  `node bin/auto-hh config` → exit 0.
- IDE-lint новых файлов: `options.ts`, `resume.ts`, `steps.ts`, `cmd-ui.ts` — без замечаний; в `menu.ts` одно
  предупреждение — дословно перенесённая строка (отступление 9).
- За владельцем: `npx tsx bin/auto-hh ui` в настоящем терминале — пройти все пункты и отменить (Ctrl+C) каждый
  промпт; убедиться, что процесс завершается без ошибок и `closeDb()` отрабатывает.

