# T-01 — Гигиена импортов и форматирование

- **Приоритет:** P3 — REVIEW.md § II **K6**
- **Этап:** 0 (нулевой шаг, до всех правок логики)
- **Зависимости:** нет
- **Объём:** ~12 файлов `src/`, только пробельные правки

## Проблема

Смешаны две конвенции относительных импортов (без расширения и с `.js`) и остались артефакты ручного форматирования:

- `"../logger"` и `"../logger.js"` вперемешку: `cmd-apply.ts:4-8`, `cmd-cover.ts:3-9`, `cmd-digest.ts:5-15`,
  `cmd-search.ts:3-8`, `cmd-schedule.ts:3-7`, `cmd-resume.ts:3-5`;
- следы ручного форматирования `import {  loadConfig  }`, `import  {getDigestsByDate, getAllDigests}`,
  `import {Vacancy}`: `clients/hh-client.ts:9-11`, `domain/filter.ts:2`, `domain/judge/judge.ts:3-4`,
  `domain/cover-letter/cover-letter.ts:3-4`, `domain/grade-resume.ts:1-4`;
- там же отсутствуют пробелы внутри фигурных скобок — единый стиль снижает шум в дифах и ревью.

Эталон стиля уже есть: `src/cli/index.ts:3-13` (все относительные импорты — с `.js`; исключение — `:14`,
`from "../clients/db"`). В `cmd-ui.ts:4-13` импорты уже однородные — этот файл в список не попал.

## Что сделать

- [x] Привести все относительные импорты к виду `путь + .js` (как в `src/cli/index.ts`).
- [x] Убрать двойные пробелы и применить `{ Foo }` вместо `{Foo}`.
- [x] Прогнать форматтер по правилам `.editorconfig` (отступы, переводы строк, финальный `\n`) —
      **не применимо:** файла `.editorconfig` в репозитории нет; правки сделаны вручную, только строки импортов.
- [x] Дополнительно (не из REVIEW.md, обнаружено при разборе `package.json`): `@types/node` находится
      в `dependencies` (`package.json:31`) — это типы только для сборки, перенести в `devDependencies`.
      Там же: `@types/node-cron@^3.0.11` (`package.json:45`) не подходит к `node-cron@^4.2.1` — см. T-13.

## Definition of Done

- [x] `git diff` содержит **только** строки импортов и пробелы — ни одной правки логики.
- [x] `npx tsc --noEmit` → exit 0.
- [x] Нет относительных импортов без `.js`.

## Проверка

```powershell
npx tsc --noEmit; Write-Output "exit: $LASTEXITCODE"
git --no-pager diff --stat
Get-ChildItem src -Recurse -Include *.ts | Select-String -Pattern 'from "\.\.?/[^"]*[^s]"' |
  Where-Object { $_.Line -notmatch '\.js"' } | ForEach-Object { "$($_.Path):$($_.LineNumber)" }
```

## Риски

Форматтер может задеть файлы, которые параллельно правятся в других тикетах, — поэтому T-01 выполняется
**первым**, отдельным коммитом и не смешивается с логикой. Если форматтер даёт большой шум, ограничиться
ручным приведением импортов и перенести правило в `.editorconfig` для будущих правок.

## Реализовано

- **21 файл, 34 строки** (17 insertions / 17 deletions в `src/` + `package.json`): 28 относительных импортов
  получили `.js`, 9 артефактов форматирования исправлены.
- `../domain/judge` заменён на `../domain/judge/index.js` (а не `judge.js`): каталог с `index.ts` под
  CJS-резолвом (`package.json` без `"type": "module"`) через `judge.js` не разрешается — прецедент есть
  в `cmd-cover.ts:4` (`../domain/cover-letter/index.js`).
- Проверки после правки: `npx tsc --noEmit` → exit 0; `npx tsx bin/auto-hh --help` → 12 команд, exit 0;
  относительных импортов без `.js` — 0; артефактов форматирования (`{  Foo  }`, `{Foo}`) — 0.
- `@types/node` перенесён в `devDependencies`; `@types/node-cron` оставлен до T-13 (он ещё импортируется
  типами `node-cron@3`).
