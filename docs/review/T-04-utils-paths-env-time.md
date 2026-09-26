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

- [ ] Новый `src/paths.ts`: `DATA_DIR`, `LOG_FILE`, `ensureDir(dir)`.
- [ ] Новый `src/env.ts`: `intFromEnv(name, def, { min, max })`, `boolFromEnv(name, def)` — единая точка
      чтения и валидации env. Заменить все 10 мест (`config.ts`, `clients/db.ts`, `cmd-apply.ts`,
      `cmd-cover.ts`, `cmd-digest.ts`).
- [ ] Новый `src/time.ts`: `sleep(ms)`, `rand(min, max)`, `dateKey(d = new Date())`.
- [ ] `config.ts`: мемоизировать `loadConfig()` (модульная переменная/`WeakMap`) + добавить `getApiConfig()`;
      убрать повторные вызовы в 5 модулях и `apiConfig`-копии из 3 файлов.
- [ ] `resume.ts`: `const RESUME_EXTS = ['.md', '.txt', '.pdf']` + `isResumeFile(name)`; обе regex собрать из массива.
- [ ] `cmd-history.ts:7` — правку путей можно отложить до T-14, если тот удаляет файл целиком.
- [ ] D10 (форматирование записи дайджеста) **не входит** в этот тикет — см. T-04a ниже.

## Отдельная подзадача T-04a (можно сделать в этом же коммите или следующим)

`printTop` (`src/cli/cmd-digest.ts:185-191`) и вывод `show` (`:273-279`) форматируют одни и те же поля
по-разному → один `formatEntry(entry, { withReason })`.

## Definition of Done

- [ ] В `src/` не осталось ни `path.join(__dirname, '..', '..', 'data')`, ни локальных `sleep`/`dateKey`.
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] Поведение не изменилось: `loadConfig()` при повторных вызовах возвращает тот же объект (мемоизация),
      значения env читаются один раз на процесс.
- [ ] Меню открывается, пункт «Конфигурация» печатает те же значения, что и до правки.

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
