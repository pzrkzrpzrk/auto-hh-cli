# T-04 — Общие утилиты: paths / env / time / расширения резюме

- **Приоритет:** P1 — REVIEW.md § I **D6**, **D7**, **D10**
- **Этап:** 1 (корень дублей — от него зависят другие тикеты)
- **Зависимости:** нет (делать после T-01, T-02)
- **Объём:** 3 новых модуля + ~12 правок в существующих файлах

## Проблема

1. **Пути — 6 копий** резолва каталога данных через `path.join(__dirname, …, 'data')`, причём глубина `..`
   зависит от того, где лежит файл (в `src/` — один `..`, в `src/cli/` и `src/store/` — два):
   `src/logger.ts:5` (это же и `LOG_FILE` → `data/app.log`), `src/store/digest-store.ts:6`,
   `src/store/reset.ts:38`, `src/cli/cmd-digest.ts:284`, `src/cli/cmd-apply.ts:103`,
   `src/cli/cmd-history.ts:7`.
2. **Дата — 3 копии** `dateKey()` / `toISOString().slice(0, 10)`: `src/store/cache-store.ts:4-6`,
   `src/store/digest-store.ts:8-10`, `src/cli/cmd-apply.ts:29`.
3. **env-числа — 10 мест** `parseInt(process.env.X || 'def', 10)`: `src/config.ts:24`,
   `src/clients/db.ts:7`, `src/cli/cmd-apply.ts:12`, `:13`, `:15`, `:35`, `:36`, `:117`,
   `src/cli/cmd-cover.ts:119`, `src/cli/cmd-digest.ts:67`.
   В `src/retry.ts` и `src/clients/ai-client.ts` таких парсеров **нет** (в отчёте они упомянуты ошибочно).
4. **`loadConfig()` перечитывается** из 5 модулей, причём в трёх — на уровне импорта
   (`src/domain/judge/judge.ts:10`, `src/domain/cover-letter/cover-letter.ts:9`, `src/domain/grade-resume.ts:7`)
   и повторно внутри (`cover-letter.ts:85`, `:114`; `src/cli/cmd-cover.ts:35`, `:143`);
   `const apiConfig = loadConfig().api || {}` скопирован в те же 3 файла.
5. **`sleep` — 2 копии** (`src/cli/cmd-apply.ts:17`, `src/clients/hh-client.ts:15`), `rand` бесхозно живёт
   в `src/cli/cmd-apply.ts:18`.
6. **Расширения резюме перечислены 3 раза**: `src/resume.ts:36` (regex), `src/resume.ts:43` (regex в `stripExt`),
   `src/resume.ts:50` (`['.md', '.txt', '.pdf']`).

## Что сделать

- [x] Новый `src/paths.ts`: `DATA_DIR`, `LOG_FILE`, `ensureDir(dir)`.
- [x] Новый `src/env.ts`: `intFromEnv(name, def, { min, max })`, `boolFromEnv(name, def)` — единая точка
      чтения и валидации env. Заменены все 10 мест (`config.ts`, `clients/db.ts`, `cmd-apply.ts` ×6,
      `cmd-cover.ts`, `cmd-digest.ts`); `boolFromEnv` заменил `String(process.env.PW_HEADLESS) === 'true'`.
- [x] Новый `src/time.ts`: `sleep(ms)`, `rand(min, max)`, `dateKey(d = new Date())`.
- [x] `config.ts`: `loadConfig()` мемоизирован (кэш по абсолютному пути, `{ reload: true }` для перечитывания)
      + добавлен `getApiConfig()`; `apiConfig`-копии убраны из `judge.ts`, `cover-letter.ts`, `grade-resume.ts`.
- [x] `resume.ts`: `const RESUME_EXTS = ['.md', '.txt', '.pdf']` + `isResumeFile(name)`; обе regex убраны —
      фильтр директории, `stripExt` и перебор расширений собраны из массива.
- [x] `cmd-history.ts:7` — правка не требуется: резолва `data/` в файле нет (кандидаты — `logger.ts`,
      `store/digest-store.ts`, `store/reset.ts`, `cli/cmd-digest.ts`, `cli/cmd-apply.ts`).
- [x] D10 (форматирование записи дайджеста) **не входит** в этот тикет — см. T-04a ниже.

## Отдельная подзадача T-04a (можно сделать в этом же коммите или следующим)

`printTop` (`src/cli/cmd-digest.ts:185-191`) и вывод `show` (`:273-279`) форматируют одни и те же поля
по-разному → один `formatEntry(entry, { withReason })`.

## Definition of Done

- [x] В `src/` не осталось ни `path.join(__dirname, '..', '..', 'data')`, ни локальных `sleep`/`dateKey`
      (паттерны остались только внутри новых `paths.ts` / `time.ts` — это и есть единый источник).
- [x] `npx tsc --noEmit` → exit 0.
- [x] Поведение не изменилось: `loadConfig()` при повторных вызовах возвращает тот же объект (мемоизация),
      env читается в тех же точках, что и раньше (модульные константы — по-прежнему один раз на процесс).
- [x] `auto-hh config` печатает тот же JSON (exit 0); пункт меню «⚙️  Конфигурация» вызывает ту же
      `cmdConfig` (`cmd-ui.ts:367`) — сам TTY-прогон меню в этом окружении не выполнялся.

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src -Recurse -Include *.ts | Select-String -Pattern "'data'\)|function dateKey|const sleep|parseInt\(process\.env"
npx tsx bin/auto-hh ui
```

## Риски

- Мемоизация `loadConfig()` меняет семантику для тестов/скриптов, которые правят `config.json` на ходу —
  в репозитории таких нет, но если понадобится, добавить `loadConfig({ reload: true })`.
- Перенос `loadConfig()` с уровня импорта на уровень вызова меняет момент чтения файла — при этом ошибки
  станут возникать позже. Сохранить текущее поведение цепочки `throw` и не глотать исключения.

## Реализовано

- **`src/paths.ts`** (новый): `DATA_DIR` (`<корень>/data`), `LOG_FILE` (`<data>/app.log`), `ensureDir(dir)`.
  Заменил 5 копий резолва каталога — `logger.ts`, `store/digest-store.ts`, `store/reset.ts`,
  `cli/cmd-digest.ts`, `cli/cmd-apply.ts`; глубина `..` больше не зависит от места файла.
- **`src/env.ts`** (новый): `intFromEnv(name, def, { min, max })`, `boolFromEnv(name, def)`.
  Заменены все 10 `parseInt(process.env.X || 'def', 10)`: `config.ts` (`REQUEST_DELAY_MS`),
  `clients/db.ts` (`MONGODB_TIMEOUT_MS`), `cli/cmd-digest.ts` (`JUDGE_BATCH_SIZE`),
  `cli/cmd-cover.ts` (`COVER_BATCH_SIZE`), `cli/cmd-apply.ts` (`PW_MIN/MAX_DELAY_MS`,
  `PW_TEST_TIMEOUT_MS`, `PW_MANUAL_TIMEOUT_MS` — и модульные константы, и повторное чтение внутри
  `applyToVacancy`). `PW_HEADLESS` переведён на `boolFromEnv`. Нечисловое значение env больше не даёт
  `NaN` (для `batchSize = 0` это раньше означало бесконечный цикл), поэтому у
  `JUDGE_BATCH_SIZE`/`COVER_BATCH_SIZE` задан `min: 1`.
- **`src/time.ts`** (новый): `sleep(ms)`, `rand(min, max)`, `dateKey(d = new Date())`. Убраны две копии
  `sleep` (`cli/cmd-apply.ts`, `clients/hh-client.ts`), бесхозный `rand` из `cli/cmd-apply.ts`
  и четыре копии `dateKey` / `toISOString().slice(0, 10)` (`store/cache-store.ts`,
  `store/digest-store.ts`, `cli/cmd-apply.ts`, `cli/cmd-resume.ts`).
- **`config.ts`**: `loadConfig()` мемоизирован по абсолютному пути — если `CONFIG_PATH` меняется
  (`--config`), файл читается заново; добавлен `{ reload: true }`. Новый `getApiConfig()` мемоизирует
  секцию `api` в `WeakMap` по объекту конфига, чтобы `getClient()` продолжал кэшировать клиент по ссылке.
  Модульные `const apiConfig = loadConfig().api || {}` убраны из `domain/judge/judge.ts`,
  `domain/cover-letter/cover-letter.ts`, `domain/grade-resume.ts` — теперь конфиг читается в момент вызова
  (то есть уже после применения `--config`), а не при импорте. Цепочка `throw` сохранена: `getApiConfig()`
  вызывается до `try`, поэтому ошибка конфига по-прежнему всплывает наружу, а не превращается в «нет клиента».
- **`resume.ts`**: `RESUME_EXTS` + `isResumeFile()` — из одного массива собраны фильтр директории,
  `stripExt()` и перебор расширений в `loadResume()`; обе regex удалены.
- **`README.md`**: в дереве `src/` добавлены новые утилиты (`env.ts / paths.ts / time.ts`).
- **Не входит (отдельным коммитом):** T-04a — общий `formatEntry(entry, { withReason })` для `printTop`
  и вывода `show`; в этом коммите вывод обеих команд не менялся.

## Проверки

- `npx tsc --noEmit` → exit 0.
- Точечный grep по `src` (`path.join(__dirname`, `function dateKey`, `const sleep`,
  `parseInt(process.env`, `loadConfig().api`) — совпадения только внутри новых `paths.ts` / `time.ts`,
  то есть единый источник правды.
- Самопроверка новых модулей (`npx tsx`, 25 проверок — все OK): UTC-ключ `dateKey`, диапазон `rand`,
  задержка `sleep`, `def`/`min`/`max` в `intFromEnv`, разбор значений в `boolFromEnv`,
  `DATA_DIR`/`LOG_FILE`, мемоизация `loadConfig()` (тот же объект) и `{ reload: true }`,
  стабильная ссылка `getApiConfig()`, типы полей `env()`.
- `npx tsx bin/auto-hh config` → exit 0, тот же JSON, что и до правки (`ConvertFrom-Json`).
- `npx tsx bin/auto-hh digest show` → exit 0, дайджест за 2026-09-24 отображается.
- Интерактивный прогон `ui` не выполнялся — TTY в этом окружении недоступен.
