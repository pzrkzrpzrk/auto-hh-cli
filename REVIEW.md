# Code Review: auto-hh-cli — рефакторинг по KISS/DRY

> Тикеты по этому ревью: [`docs/review/`](docs/review/README.md) — 16 штук, один тикет ≈ один коммит.

> Номера строк сверены с рабочим деревом на коммите `c58e6dc` (все 16 тикетов проверены против этого же состояния).

- **Проект:** auto-hh-cli — CLI для поиска вакансий и откликов на hh.ru
- **Стек:** TypeScript, Node.js (CJS, запуск через `tsx`), MongoDB (нативный драйвер), Playwright (persistent context), OpenAI-совместимый ИИ-клиент, `@inquirer/prompts`, `node-cron@4.2.1`
- **Объём ревью:** весь `src/` (37 файлов, 3 548 строк), `package.json`, `tsconfig.json`, `config.json`, `.env.example`, `migrations/`, README
- **Метод:** статический аудит, без прогона пайплайна (нет MongoDB, Playwright-профиля и ключа ИИ)
- **Состояние на момент ревью:** `npx tsc --noEmit` → exit 0; тестов нет (`tests/`, `scripts/` в репозитории отсутствуют, хотя README на `scripts/` ссылается)

## TL;DR

Код читаемый и хорошо закомментированный, но за время эволюции (hh.ru API → Playwright-скрейпинг; поверх CLI-подкоманд добавлено меню `ui`, при этом сами подкоманды остались) накопилось **14 мест дублирования** и **~8 зон излишней сложности / мёртвого кода**. Аккуратный рефакторинг даёт **−250…−350 строк** без потери функциональности. Дополнительно найдено **4 функциональных риска**, не связанных со стилем (раздел IV) — их стоит закрыть независимо от рефакторинга.

| Приоритет | Пункты | Почему |
|---|---|---|
| **P0** | F1, F2, F3, F4, K5 | влияют на корректность/производительность, а не на вид кода |
| **P1** | D1, D2, D3, D4, D6, D14, K1, K2 | 5-40 строк в 2-6 копиях каждая |
| **P2** | K3, K4, D5, D7-D13 | удаляется/сокращается без изменения поведения |
| **P3** | K6 | шум, затрудняет чтение и правки |

---

## I. DRY — дублирование

### D1. «Подклеить письма из кэша к записям дайджеста» — 3 копии
- `src/cli/cmd-apply.ts:245-249`
- `src/cli/cmd-cover.ts:74-79` (вариант с `opts.force`)
- `src/cli/cmd-digest.ts:267-268`

Все три: `getLettersByVacancyIds(entries.map(e => e.id))` → merge `letters[String(e.id)] || e.coverLetter || ''`.
**Предложение:** `store/cache-store.ts` → `withCoverLetters(entries, { force = false })`.

### D2. «Догрузить отсутствующие полные карточки с hh.ru» — 3 копии
- `src/cli/cmd-digest.ts:26-43` (внутри `filterLocally` :22-55)
- `src/cli/cmd-cover.ts:88-111` (`coverDigest`)
- `src/domain/collect.ts:49-97` (`collectFullVacancies` — с вариациями: статистика, `history.isSeen` на строке `cmd-digest.ts:28`)

Общая суть: взять из кэша (`getFullByVacancyIds` / `cache.fullById`) → для отсутствующих `client.getVacancy(id)` → записать в `cache.fullById` и `saveFullVacancy` → `log.warn` при ошибке.
**Предложение:** `domain/collect.ts` → `ensureFullVacancies(client, ids, cache, { skipSeen, onProgress })`, а `collectFullVacancies` сделать тонкой обёрткой.

### D3. Два парсера ответа модели + два способа достать список
- `src/text-utils.ts:5-10` — `parseJSON` (снимает фенсы ```` ``` ```` и `**`; fallback по `{`…`}` из описания ниже в коде **отсутствует**)
- `src/domain/grade-resume.ts:9-31` — `safeJsonParse` (своя эвристика экранирования кавычек, срез управляющих символов); общий `parseJSON` **не** используется
- Извлечение массива: `src/domain/judge/judge.ts:153` (`parsed.verdicts || []`) и `src/domain/cover-letter/cover-letter.ts:170` (`parsed.letters || []`)

**Предложение:** один `parseJSON` (объединить обе стратегии) + `asList(parsed, key)`.

### D4. Пул воркеров «пачки + concurrency» — 2 почти идентичные реализации
- `src/cli/cmd-digest.ts:57-113` (`judgeWithClaude`)
- `src/domain/cover-letter/cover-letter.ts:121-193` (`buildCoverLettersBatch`)

Общий каркас: `chunk` → `nextBatchIdx` → `worker()` → `Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, ...))`, с `try/catch` на пачку и прогрессом.
**Предложение:** новый `src/concurrency.ts`: `chunk(items, size)`, `runBatches(batches, concurrency, fn)`.

### D5. Мапа «vacancy → запись дайджеста» объявлена дважды в одном файле
- `src/cli/cmd-digest.ts:132-141` (для `rejected`, внутри `selectAccepted` :114-151)
- `src/cli/cmd-digest.ts:159-170` (для `matched`, внутри `buildResults` :155-183)

Одни и те же 11 полей. При этом `DigestEntry` уже есть в `src/types.ts:44-55` (и используется в `src/store/digest-store.ts:4` как тип Mongo-документа), но **эти литералы им не типизированы**.
**Предложение:** `toDigestEntry(full, { score, reason, comment, coverLetter }) : DigestEntry`.

### D6. Пути, дата и env-хелперы продублированы по всему проекту
- резолв каталога данных (`path.join(__dirname, …, 'data')`) — **6 копий**, причём глубина `..` зависит от расположения файла (в `src/` — один, в `src/cli/` и `src/store/` — два), хотя результат один и тот же: `src/logger.ts:5`, `src/store/digest-store.ts:6`, `src/store/reset.ts:38`, `src/cli/cmd-digest.ts:284`, `src/cli/cmd-apply.ts:103`, `src/cli/cmd-history.ts:7`
- `dateKey()` / `toISOString().slice(0, 10)` — 3 копии: `src/store/cache-store.ts:4-6`, `src/store/digest-store.ts:8-10`, `src/cli/cmd-apply.ts:29`
- `loadConfig()` — 5 модулей, причём в трёх **на уровне импорта** (`src/domain/judge/judge.ts:10`, `src/domain/cover-letter/cover-letter.ts:9`, `src/domain/grade-resume.ts:7`) и повторно внутри (`cover-letter.ts:85` и `:114`; `src/cli/cmd-cover.ts:35` и `:143`); плюс `const apiConfig = loadConfig().api || {}` скопирован в те же 3 файла
- `parseInt(process.env.X || 'def', 10)` — **10 мест**: `src/config.ts:24`, `src/clients/db.ts:7`, `src/cli/cmd-apply.ts:12,13,15,35,36,117`, `src/cli/cmd-cover.ts:119`, `src/cli/cmd-digest.ts:67`

**Предложение:** `src/paths.ts` (`DATA_DIR`, `LOG_FILE`, `ensureDir`), один `dateKey()`, мемоизированный `loadConfig()` + `getApiConfig()`, `intFromEnv(name, def, { min })` в `src/env.ts`.

### D7. Расширения резюме перечислены 3 раза
`src/resume.ts:36` (regex), `src/resume.ts:43` (regex в `stripExt`), `src/resume.ts:50` (массив `['.md', '.txt', '.pdf']`).
**Предложение:** `const RESUME_EXTS = ['.md', '.txt', '.pdf']` + `isResumeFile(name)`.

### D8. Список резюме для выбора собирается дважды
`src/cli/cmd-ui.ts:113-141` (`pickResume`) и `src/cli/cmd-ui.ts:142-180` (`runPickActiveResume`) — одинаковые `choices` с пометкой активного/незарегистрированного.
**Предложение:** `resumeChoices({ markLabel })`.

### D9. Форматирование ЗП переписано вместо готового
`src/cli/cmd-cover.ts:15-20` дублирует `fmtSalary` из `src/domain/collect.ts:111-117`.
**Предложение:** импортировать `fmtSalary`.

### D10. Мелкие утилиты и вывод
- `sleep` — 2 копии: `src/cli/cmd-apply.ts:17`, `src/clients/hh-client.ts:15`
- `rand` — есть только в `src/cli/cmd-apply.ts:18` (перенести в общий модуль вместе с `sleep`)
- Печать записи дайджеста: `printTop` (`src/cli/cmd-digest.ts:185-191`) и вывод в `show` (`src/cli/cmd-digest.ts:273-279`) форматируют одни и те же поля по-разному

### D11. Поиск по id — один и тот же алгоритм
`src/store/cache-store.ts:91-98` (`getFullByVacancyIds`) и `src/store/cache-store.ts:126-133` (`getLettersByVacancyIds`): dedupe → `$in` → `map`.
**Предложение:** `findByIds(collection, ids, valueField)`.

### D12. Дублирование внутри `applyToVacancy`
`src/cli/cmd-apply.ts`: парсинг `PW_MIN/MAX_DELAY_MS` дважды (строки 12-13 **и** 35-36, то есть внутри цикла по вакансиям), блок «test required» дважды (70-83 и 152-164), `detectPostState` вызывается дважды с одинаковым разбором.
**Предложение:** вынести `handleTestRequired(page)` и `ensureDraftSubmitted()`; env читать на уровне модуля (как в строках 12-15).

### D13. Категории оценки резюме объявлены дважды
`src/cli/cmd-grade-resume.ts:49-55` (Markdown) и `src/cli/cmd-grade-resume.ts:127-131` (консоль) — одни и те же 25/25/20/20/10 и одни и те же ключи, обходятся двумя разными циклами. Плюс промпт оценки (95 строк) лежит inline в `src/domain/grade-resume.ts:33-95`, тогда как у `judge` и `cover-letter` промпты вынесены в `system-text.ts`.
**Предложение:** таблица `CATEGORIES = [{ key, title, max }]` + единый обход; промпт → `src/domain/grade-resume/system-text.ts`.

### D14. Запуск Chromium и логин продублированы между `cmd-apply` и `hh-client`
- `PROFILE` объявлен дважды: `src/cli/cmd-apply.ts:10` и `src/clients/hh-client.ts:13`
- `chromium.launchPersistentContext(...)` с одинаковыми опциями: `src/cli/cmd-apply.ts:219-222`, `src/cli/cmd-apply.ts:255-258`, `src/clients/hh-client.ts:101-104`
- `ctx.pages()[0] || await ctx.newPage()` — в `cmd-apply.ts` ×2 и `src/clients/hh-client.ts:106`
- `ensureProfile()` (`src/cli/cmd-apply.ts:20-22`) нужен именно потому, что `cmd-apply` не переиспользует `HhClient`

**Предложение:** один хелпер `openBrowser({ headless })` (или переиспользование `HhClient` в `cmd-apply`).

---

## II. KISS — излишняя сложность

- **K1. `src/cli/cmd-ui.ts` — 413 строк, 10+ обязанностей.** Внутри: сборка опций (`buildSearchOptions` :56, `buildDigestOptions` :61, `buildCoverOptions` :77, `buildApplyOptions` :84), описание окружения (:91, :104), выбор резюме (:113, :142, :181), счётчики (:197), шаги меню (:206-319) и список пунктов (:325-341), `mainMenu` (:320), `dispatch` (:346), `cmdUi` (:373), обработка Ctrl+C и `process.exitCode` (:400).
  **Разбить:** `cli/ui/options.ts`, `cli/ui/resume.ts`, `cli/ui/steps.ts`, `cli/ui/menu.ts`.

- **K2. `src/cli/cmd-apply.ts` — 303 строки, два «бога».** `apply()` (:228-302, 75 строк) и `applyToVacancy()` (:33-168, 136 строк) с большой вложенностью: проверка отклика → логин → нажатие кнопки → заполнение письма → тест → ручное подтверждение → случайная задержка.
  **Разбить:** `ensureLoggedIn`, `findResponseButton`, `fillLetter`, `handleTestRequired`, `waitForManualSubmit`.

- **K3. `src/cli/cmd-schedule.ts:24-60` — 37 строк ручного парсера cron**, хотя установлен `node-cron@4.2.1`, у которого есть `ScheduledTask.getNextRun(): Date | null` (`node_modules/node-cron/dist/cjs/tasks/scheduled-task.d.ts:33`). Самописный матчер к тому же неверно обрабатывает диапазоны и `*/n` со смещением в day-of-week.
  **Заменить на:** создать задачу → `task.getNextRun()` (и печатать «следующий запуск» уже из него).

- **K4. Мёртвый код (проверено grep'ом по всему репозиторию):**

| Что | Где | Статус |
|---|---|---|
| `cmd-history` — источник данных | `src/cli/cmd-history.ts:7` (весь файл — 40 строк) | читает `data/history.json`, который **никто не пишет** (история — коллекция `history` в MongoDB) → и команда `history` (`src/cli/index.ts:50-54`), и пункт меню «🕓 История откликов» (`cmd-ui.ts:332`, dispatch :358) всегда печатают «No history yet.» |
| `env()` — OAuth-поля | `src/config.ts:17-23` | `HH_CLIENT_ID/SECRET/REDIRECT_URI/ACCESS_TOKEN/REFRESH_TOKEN/RESUME_ID` не используются нигде; README сам зовёт их зарезервированными (README:383), а `src/oauth-server.js`, на который он ссылается, в репозитории нет. Реально нужны `userAgent` (:22) и `requestDelayMs` (:24) |
| `Verdict.coverLetter` | `src/types.ts:21`, заполняется в `src/domain/judge/judge.ts:34` | всегда `''`, никем не читается (промпт сам требует пустую строку) |
| `history.isApplied` | `src/store/history-store.ts:52-56` | нет ни одного вызова (только дефолтный экспорт на строке 64) — при этом оно ровно то, что нужно вместо `history.load()` в цикле (см. F1) |
| Легаси-алиасы шага digest | `src/cli/cmd-digest.ts:295-306` | `SHOW_ACTIONS = ['show','last','latest','view']` (:295), ветка `typeof action === 'object'` (:299-302) и алиасы `make`/`create` (:306). Из меню достижимы только `build` (`cmd-ui.ts:222`) и `show` (`cmd-ui.ts:356`); ветка-объект недостижима ниоткуда (Commander всегда передаёт строку — `index.ts:41,48`), алиасы `last/latest/view/make/create` живы только через прямой вызов `auto-hh digest <alias>` |
| Экспорт без потребителей | `src/cli/cmd-digest.ts:312` | `export { build as buildDigest, show as showDigest }` — никто не импортирует (проверено grep'ом по `src/`) |
| Комментарий-блок | `src/domain/adapt-resume.ts:35-37` | закомментированный код |
| `filter.requiredSkills` | `config.json:13` | не читается `src/domain/filter.ts` (там используются только `excludeArchived` :30, `excludedCompanies` :35, `excludedKeywords` :45, `minSalaryRub` :50, `locationRule` :61) |
| `@ts-nocheck` | `src/clients/hh-client.ts:1` | 202 строки без проверки типов — единственный такой файл; `cmd-apply.ts` тоже без типов (`page`, `entry` — `any`) |
| `src/apply-playwright.ts` (19 строк) | весь файл | легаси-обёртка «`node src/apply-playwright.js` = `auto-hh apply`»; сама зовёт `process.exit(0)`/`process.exit(1)` (:15, :18), из-за чего `finally { closeDb() }` не отрабатывает. Решение за владельцем: удалить (README уже помечает её легаси-точкой входа — README:441, :454) или переписать на `exitCode` — см. F1 |
| `scripts/**/*.ts` в `include` | `tsconfig.json:15` | каталога `scripts/` в репозитории нет (см. F4) — мёртвая строка конфигурации |

- **K5. Лишние round-trip'ы и работа в цикле:**
  - `src/cli/cmd-apply.ts:278` — `await history.load()` **внутри** цикла по вакансиям: полная выгрузка коллекции на каждую вакансию. Лечится `history.isApplied(id)` (который уже есть, см. K4).
  - `src/store/history-store.ts:39-50` (`markSeen`) — `findOne` + `updateOne`; достаточно одного `updateOne` с фильтром `{ vacancyId, status: { $ne: 'applied' } }`.
  - `src/cli/cmd-digest.ts:33,38,47` — `markSeen` по одному документу на вакансию (в цикле до 1000 вакансий) → `bulkWrite`.
  - `src/domain/cover-letter/cover-letter.ts:174-176` — `onBatch(result)` отдаёт **всю накопленную** карту, поэтому `coverDigest` (`src/cli/cmd-cover.ts:121-126`) при каждой новой пачке заново пишет в MongoDB письма всех предыдущих → передавать только новые.

- **K6. Единообразие (не влияет на работу, мешает чтению):** смешаны импорты `"../logger"` и `"../logger.js"`; встречаются `import {  loadConfig  }`, `import  {getDigestsByDate, getAllDigests}`, `import {Vacancy}`. Файлы: `cmd-apply.ts:4-8`, `cmd-cover.ts:3-9`, `cmd-digest.ts:5-15`, `cmd-search.ts:3-8`, `cmd-schedule.ts:3-7`, `cmd-resume.ts:3-5`, `clients/hh-client.ts:9-11`, `domain/filter.ts:2`, `domain/judge/judge.ts:3-4`, `domain/cover-letter/cover-letter.ts:3-4`, `domain/grade-resume.ts:1-4`; плюс `index.ts:14` (`from "../clients/db"` без `.js`). Эталон — `src/cli/index.ts:3-13`. `tsc` это принимает (CJS), но лучше привести к `.js` везде и прогнать форматтер по `.editorconfig`.

---

## III. Типовые пробелы

- `src/types.ts:4` — `Vacancy.description: string` объявлен обязательным, но `mapSearchItem` (`src/clients/hh-client.ts:41-53`) его не возвращает; ошибка не видна только из-за `@ts-nocheck`. Реальная форма — `description?: string`.
- `judge.ts`, `cover-letter.ts`, `collect.ts`, `cmd-digest.ts`, `cmd-apply.ts` активно используют `any` / `Record<string, any>`; `DigestEntry` и `Verdict` есть, но на границах не применяются.
- `src/logger.ts` — `debug` управляется `process.env.DEBUG`, а `log.error` пишет через `console.log` (не `console.error`), то есть ошибки уезжают в stdout.

---

## IV. Функциональные риски (не про стиль)

- **F1. `process.exit(1)` внутри модулей команд.** `src/cli/cmd-resume.ts:31,36,48,52` и `src/cli/cmd-schedule.ts:69,77` вызывают `process.exit(1)`. В режиме меню это убивает процесс целиком: не отработает `finally` в `run()` (`src/cli/index.ts:107-109` — закрытие MongoDB), и пользователь вылетает из приложения после одной неудачной команды, хотя теперь в CLI доступны и обычные подкоманды (`index.ts:23-97`), где цена та же. Остальные места ведут себя правильно — `process.exitCode = 1` (`cmd-ui.ts:400`, `cmd-cover.ts:42,148`, `cmd-digest.ts:309`, `cmd-apply.ts:267`, `index.ts:106`). Отдельно: `src/apply-playwright.ts:15,18` — легаси-обёртка, тоже обрывает процесс (см. K4). Нужен единый стиль: `exitCode` + `return`/`throw`.
- **F2. `cmd-history` показывает всегда пусто** (см. K4): `data/history.json` никем не создаётся, хотя команда зарегистрирована (`index.ts:50-54`) и есть пункт меню. Либо переписать на `history-store.load()`, либо убрать команду/пункт меню.
- **F3. `data/` в рабочем каталоге:** `git ls-files data` → 0 файлов, `.gitignore` содержит `data/` — то есть в git ничего не утечёт. Но каталог `data/browser-profile` с cookies сессии физически лежит в проекте; стоит явно предупредить в README, что его нельзя ни коммитить, ни копировать в бэкапы.
- **F4. README расходится с кодом:** указан каталог `scripts/` (README:445) — его нет; файл `src/oauth-server.js` (README:383) — его тоже нет, а OAuth-переменные из этого раздела не читаются кодом. В дереве проекта `cmd-cover.ts` указан дважды (README:414 и :419). Легаси-точка входа `src/apply-playwright.ts` описана в README:441 и :454 — файл существует, но это обёртка, которую решено удалить/переписать (K4). Файл `data/history.json` в README **не** упоминается (проверено grep'ом) — он встречается только в коде: `src/cli/cmd-history.ts:7`, см. F2.

---

## V. План рефакторинга (по этапам, каждый — отдельный коммит)

**Этап 0 — гигиена (нулевой риск)**
1. Импорты к `.js`, удаление артефактов форматирования (K6); прогон форматтера по `.editorconfig`.
2. Удаление мёртвого кода из K4: OAuth-поля в `env()`, `Verdict.coverLetter`, закомментированный блок в `adapt-resume.ts`, легаси-алиасы `cmdDigest`, экспорт `buildDigest/showDigest`, `requiredSkills` из `config.json`. (`history.isApplied` **не** удалять — его надо переиспользовать.)
3. Исправление `process.exit` → `exitCode` (F1).

**Этап 1 — общие утилиты (корень дублей)**
4. `src/paths.ts` (`DATA_DIR`, `LOG_FILE`, `ensureDir`) → перевести logger, digest-store, reset, cmd-digest, cmd-apply, cmd-history.
5. `src/env.ts`: `intFromEnv`, `boolFromEnv` → retry, ai-client, config, cmd-apply, cmd-cover, cmd-digest.
6. `src/time.ts`: `sleep`, `rand`, `dateKey`.
7. `text-utils.ts`: слить `parseJSON` и `safeJsonParse`, добавить `asList()`.
8. `src/concurrency.ts`: `chunk()` + `runBatches()`; перевести `judgeWithClaude` и `buildCoverLettersBatch`.
9. `resume.ts`: `RESUME_EXTS` + `isResumeFile()`; `config.ts`: мемоизация `loadConfig()` + `getApiConfig()`.

**Этап 2 — `store/`**
10. `withCoverLetters()` (D1) вместо 3 копий.
11. `findByIds()` вместо `getFullByVacancyIds`/`getLettersByVacancyIds` (D11).
12. `markSeen` одним запросом; батч-отметки в `cmd-digest`; `onBatch` только с новыми письмами (K5).
13. `isApplied` — использовать в `cmd-apply` вместо `history.load()` в цикле (K5).

**Этап 3 — `domain/`**
14. `ensureFullVacancies()` (D2).
15. `toDigestEntry()` + типизация `DigestEntry` (D5).
16. `CATEGORIES` + вынос промпта в `domain/grade-resume/system-text.ts` (D13).
17. `fmtSalary` в `cmd-cover`; `Vacancy.description` → опциональный (D9, III).

**Этап 4 — CLI**
18. Распил `cmd-ui.ts` (K1) и `cmd-apply.ts` (K2, D12).
19. Общий `openBrowser()` (D14).
20. `cmd-schedule.ts`: `getNextDate` → `task.getNextRun()` (K3).
21. `cmd-history`: переписать на `history-store.load()` **или** убрать пункт меню (F2) — решение за владельцем.

**Этап 5 — верификация и документация**
22. `npx tsc --noEmit` после каждого этапа; точечные ручные прогоны безопасных пунктов меню.
23. Синхронизация README: структура `src/` (в дереве дважды указан `cmd-cover.ts` — README:414 и :419), отсутствие каталога `scripts/` (README:445) и файла `src/oauth-server.js` (README:383), судьба легаси-точки входа `src/apply-playwright.ts` (README:441, :454), предупреждение о содержимом `data/browser-profile` (F3, F4).

**Ожидаемый эффект:** −250…−350 строк, два (а не шесть) места резолва путей, один парсер JSON, один пул воркеров, `cmd-ui.ts`/`cmd-apply.ts` разбиты на модули по 80-150 строк, `tsc` остаётся чистым.

---

## VI. Ограничения и как проверять

- Автотестов нет, поэтому верификация возможна только `npx tsc --noEmit` + ручные прогоны. Рефакторинг обязателен маленькими коммитами.
- Полный прогон требует MongoDB, Playwright-профиля с живой сессией hh.ru и ключа ИИ — в рамках ревью не выполнялся; всё выше найдено статическим анализом.
- Безопасные для проверки точки: `config` (вывод конфига), `digest show` (чтение MongoDB), `cover` без ключа ИИ (ветка ошибки), отмена промптов (Ctrl+C).
- Инварианты, которые рефакторинг **не должен** менять: формат диалогов меню, имена env-переменных, схемы Mongo-коллекций (`cachePages`, `cacheFull`, `cacheJudgements`, `cacheCoverLetters`, `history`, `digest`, `rejected`, `resumes`), формат `.md`-файлов дайджеста.

---

## VII. Что проверено и отклонено как «мёртвый код»

Чтобы не удалить лишнее, кандидаты проверялись grep'ом по всему репозиторию:

| Символ | Результат |
|---|---|
| `checkAlreadyResponded` | **используется** — `src/cli/cmd-apply.ts:41` (определение на :178) |
| `detectPostState` | **используется** — `src/cli/cmd-apply.ts:71,152` (определение на :170) |
| `Verdict` | **используется** как тип — `src/domain/judge/judge.ts:7,14` |
| `DigestEntry` / `DigestDoc` | **используются** как типы — `src/store/digest-store.ts:4,46-64` |
| `isSeen` | **используется** — `src/cli/cmd-digest.ts:28` |
| `isApplied` | **не используется** нигде → кандидат на переиспользование (K5), а не на удаление |
