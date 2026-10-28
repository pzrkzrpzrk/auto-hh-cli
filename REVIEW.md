# Code Review: auto-hh-cli — после миграции на SQLite и аудита Clean Architecture

> **Актуально на 2026-10-28**, ветка `refactor/t-25-t-31` (от `development`, коммит `c9de575`).
> Тикеты к отчёту — [`docs/review/`](docs/review/README.md).

> **Что это за документ.** Перепроверка прошлого отчёта (KISS/DRY, дерево до архитектурного
> рефакторинга, коммит `c58e6dc`) на текущем коде: что закрыто, что осталось и что появилось нового.
> Пути и номера строк — по рабочему дереву на 2026-10-28; актуальная раскладка слоёв —
> [`docs/architecture.md`](docs/architecture.md).

- **Проект:** auto-hh-cli — CLI для поиска вакансий и откликов на hh.ru
- **Стек:** TypeScript 6 (`nodenext`, `strict`), Node.js ≥ 22.13, запуск через `tsx`; хранилище — встроенный
  `node:sqlite` (`data/autohh.db`, адаптеры в `infrastructure/sqlite/`); Playwright (persistent context);
  OpenAI-совместимый ИИ-клиент; `@inquirer/prompts`; `node-cron@4.2.1`; тесты — vitest,
  границы слоёв — dependency-cruiser, линт — ESLint 10
- **Объём ревью:** `src/` — 166 файлов, 10 559 строк (application 63/3 085, infrastructure 39/3 513,
  domain 32/2 188, presentation 20/1 274, shared 11/310, `composition.ts` 189); `tests/` — 8 спеков,
  538 строк, 46 тестов; `bin/auto-hh`, `package.json`, `tsconfig.json`, `.env.example`,
  `config.example.json`, `README.md`, `docs/architecture.md`
- **Метод:** статический аудит (`Select-String` по `src/`, чтение модулей) + штатные проверки проекта.
  Живых прогонов `search`/`digest`/`cover`/`apply` нет: нужны сессия hh.ru, ключ ИИ и лимиты аккаунта

| Проверка | Команда | Результат |
|---|---|---|
| Типы исходников | `npx tsc --noEmit` | exit 0 |
| Границы слоёв | `npm run arch` | 0 нарушений (171 модуль, 648 зависимостей) |
| Типы тестов | `npm run test:types` | exit 0 |
| Тесты | `npx vitest run --reporter=dot` | 8 файлов, 46 тестов — все зелёные |
| Smoke CLI | `node bin/auto-hh --version` / `--help` | `1.0.0`, help exit 0 |

## TL;DR

Дерево в рабочем состоянии: слои не протекают (`application` не импортирует `infrastructure` — 0
совпадений), `strict` включён, проверки зелёные. Из 14 дублей KISS/DRY (D1–D14) сняты все:
D3 закрыт вместе с T-28 (`parseJSON` — единственный парсер), D13 — вместе с R1. K3 (самописный cron)
закрыт в T-30, K4–K6 закрыты частично. Функциональные риски F1–F4 сняты: `process.exit`
из `cmd-resume` убран в T-29, дрейф документации исправлен в T-31.

P1 закрыты: R1 — T-28 (`ab70b9d`), R2 — T-29 (`fa48c17`, `9e23a14`). R3 закрыт в T-26 (тесты на фейковых
портах), адаптеры hh.ru разбиты в T-25, cron и документация — в T-30/T-31. Открытых пунктов R1–R9
нет; остаётся долг R7/R8 уровня P3 (типизация и мелочи), он вынесен в §II.

| Приоритет | Пункт | Почему |
|---|---|---|
| ✅ **P1** | R1. `domain/grade-resume` держит ИИ-вызов, промпт и свой JSON-парсер | закрыто в T-28: `GradePrompt`, VO `ResumeGrade`, `ResumeGradeService` |
| ✅ **P1** | R2. `cmd-resume` обрывает процесс `process.exit(1)` | закрыто в T-29: `process.exitCode` + `return`, меню остаётся живым |
| ✅ **P2** | R3. Тесты покрывают ≈12 модулей из 166 | закрыто в T-26 (+ T-25): 22 файла / 131 тест на фейковых портах и `:memory:` |
| ✅ **P2** | R4. Документация отстала от кода | закрыто в T-31: `scripts/`, `MONGODB_*`, счётчики и предупреждение о профиле |
| ✅ **P2** | R5. Мёртвая поверхность конфигурации | закрыто в T-31: `env()` = `userAgent`/`requestDelayMs`, `loadConfig()` удалён |
| ✅ **P2** | R6. Самописный cron вместо `getNextRun()` | закрыто в T-30: `Scheduler.nextRun()`, `shared/cron.ts` удалён |
| **P3** | R7. 143 `any` | хот-споты после T-25 — `hh/resume-raw.ts` (16) и `hh/resume-lookup.ts` (14) |
| **P3** | R8. Мелочи единообразия | шум в диффах, дубли логгера и интерфейсов |

---

## I. Судьба прошлых находок (D1–D14, K1–K6, F1–F4)

Сверка шла по текущему дереву: для каждого пункта искалось место, куда он переехал.

| Пункт | Сейчас | Статус |
|---|---|---|
| **D1** подклейка писем ×3 | порт `CoverLetterCache.attach` (`domain/ports.ts`, адаптер `infrastructure/sqlite/cover-letter-cache.ts`); вызовы — `application/cover/stages.ts:47`, `application/apply/stages.ts:87,90` | ✅ |
| **D2** догрузка полных карточек ×3 | `application/search/VacancyCollector.ts:72-107` (`ensureFullCards`); переиспользуют `application/cover/stages.ts:75-79` и стадии digest | ✅ |
| **D3** два парсера JSON | один `parseJSON` — `shared/text-utils.ts:5`; свой `safeJsonParse` удалён вместе с `domain/grade-resume.ts` (T-28) | ✅ |
| **D4** пул воркеров ×2 | `shared/batches.ts:6` (`chunk`) и `:42` (`runBatches`) — оба ИИ-шага ходят через них | ✅ |
| **D5** мапа «vacancy → запись» ×2 | `domain/digest/DigestEntryFactory.ts` + VO `DigestCandidate` | ✅ |
| **D6** пути/дата/env по всему проекту | `infrastructure/config/paths.ts`, `infrastructure/config/env.ts`, `shared/time.ts:14` (`dateKey`); домен больше не зовёт `loadConfig()` | ✅ |
| **D7** расширения резюме ×3 | `infrastructure/files/resume-loader.ts:36` (`RESUME_EXTS`), `:40` (`isResumeFile`) | ✅ |
| **D8** список резюме ×2 | `presentation/cli/menu/resume.ts` (`resumeChoices`) | ✅ |
| **D9** форматирование ЗП | `shared/format.ts` (`fmtSalary`), реэкспорт из `application/collect.ts:12` | ✅ |
| **D10** `sleep`/`rand`/`printTop` | `shared/time.ts:4,9`; печать дайджеста — `presentation/cli/format/digest-report.ts` | ✅ |
| **D11** поиск по id ×2 | `infrastructure/sqlite/cache-store.ts:105` (`findByIds`, один на `cache_pages`/`cache_full`) | ✅ |
| **D12** дубли внутри `applyToVacancy` | `application/apply/` (13 модулей) + `infrastructure/playwright/apply-steps.ts`; env читается один раз | ✅ |
| **D13** категории оценки и промпт | категории — `presentation/cli/format/grade-report.ts` (VO `ResumeGrade`), промпт — `domain/grade-resume/GradePrompt.ts` (T-28) | ✅ |
| **D14** запуск Chromium и логин | `infrastructure/playwright/browser.ts` (`openBrowser`, `assertProfileExists`) | ✅ |
| **K1** `cmd-ui.ts` на 413 строк | `presentation/cli/menu/`: `menu.ts` 143, `steps.ts` 194, `options.ts` 38, `resume.ts` 137, `resume-download.ts` 53 | ✅ |
| **K2** `cmd-apply.ts` на 303 строки | `application/apply/` (сценарий, конвейер, 5 стадий, `ApplicationRunner`, стратегии) + `apply-steps.ts` 199 | ✅ |
| **K3** самописный парсер cron | `shared/cron.ts:1-42` жив; `Scheduler` не отдаёт next run | ❌ → R6 |
| **K4** мёртвый код | в основном вычищено; остались OAuth-поля в `env()`, `scripts/**/*.ts` в `tsconfig`; `process.exit` и ветка-объект `cmdDigest` удалены (T-29) | ⚠️ → R4, R5 |
| **K5** лишние round-trip'ы | `history.load()` один раз на прогон (`application/apply/stages.ts:101`), `markSeen` — атомарный upsert (`history-store.ts:45-54`); остались поштучные `markSeen` (`application/digest/stages.ts:93,108,109`) | ⚠️ |
| **K6** единообразие импортов | алиас `@/` и `.js` везде; остались `import {  Command  }` и дубль заголовка в `presentation/cli/index.ts:1-5` | ⚠️ → R8 |
| **F1** `process.exit` внутри модулей | убран: `cmd-resume` выставляет `process.exitCode` и возвращается (T-29); в `src/` остались только комментарии | ✅ |
| **F2** `cmd-history` всегда пуст | `application/history.ts` + `infrastructure/sqlite/history-store.ts` (таблица `history`) | ✅ |
| **F3** профиль браузера в проекте | описан в `README.md:350,379`, но предупреждения «не копировать в бэкапы» нет | ⚠️ → R4 |
| **F4** README расходится с кодом | дрейф остался: `README.md:439,448`, `docs/architecture.md:700` | ⚠️ → R4 |

---

## II. Актуальные находки

### R1 (P1) Домен оценки резюме держит ИИ, промпт и свой JSON-парсер — единственное место, выпадающее из T-24/T-27

**Статус: ✅ закрыто в T-28** (`ab70b9d`) — ниже описание находки на момент отчёта.

`src/domain/grade-resume.ts` (139 строк) целиком построен по старому образцу:

- `:5-28` — собственный `safeJsonParse`: фенсы, `**`, эвристика экранирования кавычек и срез
  управляющих символов. Общий `parseJSON` (`shared/text-utils.ts:5`) не используется, хотя после D3
  он умеет и фенсы, и фрагмент `{…}`.
- `:30-92` — системный промпт строкой в домене (у `judge` и `cover-letter` после T-27 промпты живут
  в Domain Services: `domain/judge/JudgePrompt.ts`, `domain/cover-letter/CoverLetterPrompt.ts`).
- `:96` — `async function gradeResume(ai: AiProvider | null, resume, logger?)`: домен делает I/O,
  ловит ошибки модели (`:133`) и возвращает `Record<string, any>`.
- `:120` — `ai.chat({ messages, json: true, label: 'оценка резюме' })`.
- `:98,103,124,129,134` — логирование из домена.

Проверка: `Select-String` по `src/domain` на `AiProvider|ai\.chat\(|logger` даёт совпадения **только**
в этом файле — остальной домен чистый. При этом `application/grade.ts` уже получает `AiProvider` и
`ResumeFiles` портами и мог бы принять весь транспорт на себя.

Почему это важно: два парсера JSON расходятся в поведении (фенсы и `**` обрабатываются одинаково,
эвристика с кавычками — только в домене), инвариант «что считается оценкой» нельзя проверить без
ключа ИИ, а правило «домен без побочек», закрытое в T-24/T-27, здесь обходится.

**Предложение (T-28):** `domain/grade-resume/GradePrompt.ts` (Domain Service), VO `ResumeGrade`
(разбор и clamp баллов), `application/grade/ResumeGradeService.ts` (вызов `ai.chat`, ошибки → `null`,
логи с прежними текстами), общий `parseJSON`. Тесты: промпт, разбор ответа, «нет ключа».

### R2 (P1) `cmd-resume` обрывает процесс и разговаривает на языке commander'а

**Статус: ✅ закрыто в T-29** (`fa48c17`, `9e23a14`) — ниже описание находки на момент отчёта.

- `src/presentation/cli/commands/cmd-resume.ts:47,51,61,65` — `process.exit(1)` в ветках ошибок.
  Команда вызывается **из меню** (`presentation/cli/menu/steps.ts:129,135`), поэтому `process.exit`
  убивает процесс целиком: не отрабатывает `finally` в `run()` (`presentation/cli/index.ts:44-53`),
  не закрывается SQLite (`closeResources()`), пользователь вылетает из приложения. Остальные команды
  уже ведут себя правильно: `process.exitCode` в `cmd-digest.ts:43`, `cmd-schedule.ts:40,45`,
  `presentation/cli/index.ts:36,49`.
- `cmd-resume.ts:88-89` — `opts: Record<string, any>` и `const sub = opts._?.join(' ')`: интерфейс
  остался от времён подкоманд commander (`_: ['list']` подставляет меню, `steps.ts:129,135`), хотя
  подкоманд в CLI больше нет (`presentation/cli/index.ts:22-40`).
- `cmd-resume.ts:14` — единственная английская строка в русском CLI
  («No resumes found. Set RESUMES_DIR or RESUME_PATH.»).
- `src/presentation/cli/commands/cmd-digest.ts:30-35` — ветка «`cmdDigest({ json: true })` = show»;
  все вызовы передают строку (`menu.ts:93`, `steps.ts:53,62,73`), то есть ветка недостижима.
  Там же `action: any` и алиасы `make/create/last/latest/view` (`:27-28,40`) — наследие подкоманд.

**Предложение (T-29):** `process.exitCode = 1` + `return`; параметры `cmd-resume` — обычный объект
`{ action?: 'list'|'register'|'show'; name?: string }`; ветку-объект и алиасы `cmdDigest` удалить.
Проверка: `Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'process\.exit\(1\)'` → пусто;
прогон пункта меню «🧾 Резюме» с заведомо отсутствующим именем не должен закрывать меню.

### R3 (P2) Тесты покрывают ≈30 модулей из 177

103 теста в 19 файлах на ~11 тыс. строк — это лучше, чем «тестов нет» в прошлом отчёте, но покрытие
точечное. Спеки проверяют: `domain/actualize`, `domain/adapt-resume` (только `DEFAULT_ADAPT_BUDGET`),
`domain/cover-letter/{config,CoverSignature,CoverTemplate,CoverLetterPrompt}`,
`domain/digest/{DigestPolicy,DigestFilter,DigestMatcher}`, `domain/judge/Verdict`,
`domain/grade-resume/{GradePrompt,ResumeGrade}`,
**сценарии** `application/search/SearchScenario`, `application/digest/DigestScenario`,
`application/cover/CoverScenario`, `application/apply/ApplyScenario`,
`application/judge/JudgeService`, `application/cover-letter/CoverLetterService`,
`application/grade/ResumeGradeService`, `application/reset` (форматтер),
**адаптеры** `infrastructure/sqlite/{db-janitor,cache-store,digest-store,history-store}`,
`presentation/cli/format/grade-report`, `presentation/cli/commands/cmd-resume`
(смоук: ошибки не убивают процесс).

Не покрыто ничего из:

| Слой | Модулей | Что именно не проверяется |
|---|---|---|
| `application/search` | 11 | `SearchPipeline`, `PageIterator`, `SearchRequestBuilder` — сценарий покрыт smoke-тестом |
| `application/apply` | 13 | `ApplyPipeline`, `Pacing`, `ApplySummary` — сценарий, `SkipRules` и выбор дайджеста покрыты |
| `application/cover` | 12 | `CoverPipeline`, стратегии `CoverMode`, `CoverPlan` и стадии — сценарий покрыт смоуком |
| `application/digest` | 14 | `DigestPipeline`, `DigestJudgeRunner`, `ActualizeScenario`, стадии — сценарий сборки покрыт |
| `application/` корень | 9 | `collect`, `config-view`, `grade` (сервис покрыт, фасад — нет), `history`, `options`, `reset`, `resume`, `resume-download`, `schedule` |
| `infrastructure/sqlite` | 12 | всё, кроме `db-janitor`: `cache-store`, `digest-store`, `history-store`, `resume-store`, `judgement-cache`, `cover-letter-cache`, `resume-registry` |
| `infrastructure/hh`, `ai`, `files`, `playwright`, `config`, `logging`, `scheduling` | 26 | скрейпинг выдачи и карточек, разбор резюме, ретраи ИИ, артефакты `.md`, селекторы отклика, чтение env и конфига |
| `presentation` | 20 | меню и остальные команды; отчёт `grade-report` и `cmd-resume` покрыты |

Практический эффект: порядок стадий, тексты логов и решения «пропустить/откликнуться» держатся
только на `tsc` и ручных прогонах. Регрессия в них ловится глазами владельца, а не тестом.

**Предложение:** расширить **T-26** (уже открыт): по одному smoke-сценарию на `SearchScenario`,
`DigestScenario`, `CoverScenario`, `ApplyScenario` на фейковых портах + `:memory:`-тесты
`cache-store`/`digest-store`/`history-store`. Проверять исход и события, а не текст лога.

### R4 (P2) Документация отстала от кода — закрыто в T-31

Приведено к фактическому состоянию:

| Было | Стало |
|---|---|
| `README.md`: `├─ scripts/ # judge-only, fill-cover-letters` | строка удалена; `tsconfig.include` — только `src/**/*.ts` |
| `README.md`: `files/: … data-janitor …` | `file-janitor`, `digest-artifacts`, `sqlite/db-janitor` — по факту |
| `docs/architecture.md`: env `MONGODB_*` | список env без Mongo |
| `docs/architecture.md`: «MongoDB: коллекции `cachePages`…» | «SQLite: таблицы `cache_pages`, `cache_full`, …» |
| `docs/architecture.md:4-6`: дата 2026-10-19, ветка `refactor/t24-domain-purity`, 154 файла | 2026-10-28, `refactor/t-25-t-31`, 183 файла, ≈12,2 тыс. строк |
| `README.md`: профиль Chromium «(cookies, localStorage)» | добавлено «**не коммитить и не бэкапить** — это доступ к аккаунту» |

### R5 (P2) Мёртвая поверхность конфигурации — закрыто в T-31

`infrastructure/config/config.ts` — `env()` теперь отдаёт только реально читаемые поля
`userAgent` и `requestDelayMs` (их берёт `HHPageSession`, `hh/session.ts:44-48`). Шесть OAuth-полей
(`clientId`, `clientSecret`, `redirectUri`, `accessToken`, `refreshToken`, `resumeId`) и обёртка
`loadConfig()` удалены: входа по токенам в проекте нет, логин выполняется в профиле Chromium.

### R6 (P2) Самописный cron — закрыто в T-30

`src/shared/cron.ts` (перебор минут на 48 часов вперёд, без `a-b/n`, `?`, имён месяцев и с
корректным day-of-week) удалён. Порт `Scheduler` (`domain/ports.ts:22-29`) теперь отдаёт
`nextRun(expression): Date | null`, адаптер `infrastructure/scheduling/node-cron.ts` берёт расчёт
у `getNextRun()` (стоящая задача или временная, которую сразу останавливает), а
`application/schedule.ts` считает next run один раз на постановку и раз — на срабатывание.
Поведение CLI сохранено: при `null` печатается «неизвестно» (`cmd-schedule.ts:49`).

### R7 (P3) Типизация: 143 `any`

`strict: true` включён, но `any` остаётся на границах с внешним миром. После T-25 адаптеры hh.ru
разложены по модулям, и «сырой JSON» сконцентрирован в двух файлах вместо одного на 743 строки.
Хот-споты:

| Файл | `any` | Что именно |
|---|---|---|
| `infrastructure/hh/resume-raw.ts` | 16 | низкоуровневый доступ к initial state hh.ru |
| `infrastructure/hh/resume-lookup.ts` | 14 | эвристики поиска резюме в дереве |
| `infrastructure/hh/resume-sections.ts` | 9 | мапперы блоков резюме |
| `infrastructure/ai/client.ts` | 7 | ответы провайдера, ошибки ретраев |
| `infrastructure/sqlite/digest-store.ts` | 5 | `entries: any[]` в 5 функциях записи |
| `infrastructure/files/digest-artifacts.ts` | 5 | вход рендера `.md` |
| `application/history.ts` | 5 | `Record<string, any>` вместо `HistoryMeta` |

Дешёвые победы (без риска для поведения):

- `application/history.ts:22-30,46,56,76,81` — порт уже отдаёт `HistoryMeta`/`HistoryState`
  (`domain/ports.ts:80,95`); заменить `any` на них.
- `infrastructure/sqlite/digest-store.ts:22,159,166,174,179` — `entries: DigestEntry[]`.
- `shared/text-utils.ts:5` — `parseJSON<T = unknown>(text: string): T | null` вместо `any`
  (после T-28 все ИИ-шаги будут разбирать ответ через него).

Остальное рационально закрывать тикетом на типизацию границ (R7, P3): тесты формы уже зафиксированы
в T-26 и T-25.

### R8 (P3) Мелочи единообразия

- `shared/logger.ts:5-8` и `infrastructure/logging/logger.ts:8-14` — форматирование строки лога
  (время МСК + JSON-meta) скопировано дважды; `shared/logger.ts:13` пишет `error` через `console.log`,
  а не `console.error`, то есть ошибки уезжают в stdout.
- `domain/logging.ts:2-7` и `shared/logging.ts:3-8` — два одинаковых интерфейса (`Logger`/`LogSink`).
  Домену разрешено импортировать `shared` (`docs/architecture.md`, раздел 2), поэтому достаточно
  `export type { LogSink as Logger }`.
- `infrastructure/logging/logger.ts:25` — `setLogSink(fileLogSink)` выполняется на импорте модуля
  (сайд-эффект), хотя комментарий рядом (`:2`) говорит «импортируется composition root, который
  регистрирует sink». Либо явный вызов из `composition.ts`, либо честный комментарий.

Закрыто в T-31: дубль комментария и двойные пробелы в `presentation/cli/index.ts`; `mongoUnavailable`
переименован в `dbUnavailable`; английская строка в `cmd-resume.ts` заменена ещё в T-29.

### R9 (P3) Запись `resume-grade.md` из presentation

- `presentation/cli/commands/cmd-grade-resume.ts:4-5,16-17` — `writeFileSync`, `join` и `process.cwd()`
  прямо в команде: файловый I/O вне `infrastructure`, формат `.md` при этом выбирает presentation.
  Остальные артефакты (дайджест, отчёты поиска) уже пишутся адаптерами `infrastructure/files`.

**Статус: ✅ закрыто в T-28** (`ab70b9d`): порт `TextFileWriter` (`domain/ports.ts`), адаптер
`infrastructure/files/text-file-writer.ts`, команда печатает имя, возвращённое адаптером.

---

## III. Что проверено и находкой не является

Чтобы не «починить» лишнее:

| Что | Почему это нормально |
|---|---|
| `catch (err: any)` в сценариях (`application/cover/CoverStage.ts:15`, `apply/ApplyStage.ts:15`, `apply/ApplicationRunner.ts:67`) | осознанная терпимость к форме ошибок ИИ/Playwright; в `grade` уже `catch (err)` + `errorMessage()` |
| `process.env` в `composition.ts:187-188` (`RESUMES_DIR`, `RESUME_PATH`) | решение composition root: сценарий получает готовый факт `layout`, а не env (T-21/T-22) |
| Мутабельный sink `shared/logger.ts` + `setLogSink` | точка DI для логирования до создания composition root (логи импорта конфига); параметризация логгера — отдельная задача, не ревью |
| `domain/adapt-resume/terms.ts` (`mongo: 'mongodb'`) | алиас технологии в словаре навыков резюме, не легаси Mongo |
| `infrastructure/sqlite/rows.ts` (`fromJson<T>`, `num`, `isoFromMs`) | набор уже единый: адаптеры строк не дублируют разбор JSON |
| `application/collect.ts` (19 строк, реэкспорт `fmtSalary`) | сознательный фасад для прежних импортов; удалять вместе с последним потребителем |

## IV. План и тикеты

Открытые тикеты серии Clean Architecture ([`docs/review/`](docs/review/README.md)):

| ID | Тикет | Приоритет | Статус |
|---|---|---|---|
| T-25 | Разбить `hh/client.ts` (804) и `hh/resume.ts` (743) на сессию, читателей и чистый разбор | P2 | ✅ |
| T-26 | Тесты на фейковых портах: сценарии `search`/`digest`/`cover`/`apply` + SQLite на `:memory:` | P2 | ✅ (кроме адаптеров hh.ru — T-25) |
| T-28 | `domain/grade-resume`: Domain Service + ИИ в `application` (R1, R9) | P1 | ✅ `ab70b9d` |
| T-29 | `presentation`: `exitCode` вместо `process.exit`, без commander-легаси (R2) | P1 | ✅ `fa48c17`, `9e23a14` |
| T-30 | `Scheduler.nextRun()` вместо самописного cron (R6) | P2 | ✅ |
| T-31 | Документация и мёртвая конфигурация: README, `architecture.md`, `tsconfig`, `env()` (R4, R5) | P2 | ✅ |

Порядок:

1. ~~**T-29**~~ — закрыт (`fa48c17`, `9e23a14`): процесс больше не умирает из меню.
2. ~~**T-28**~~ — закрыт (`ab70b9d`): домен в рамках T-24/T-27, второй парсер JSON убран.
3. ~~**T-26**~~ — закрыт по сценариям и SQLite (`2eacd67`, `ec7ee5b`, `a5f245f`, `eb7c7f5` + SQLite-спеки):
   поведение search/digest/cover/apply и хранилищ зафиксировано на фейковых портах.
4. ~~**T-25**~~ — закрыт: `hh/client.ts` (804) и `hh/resume.ts` (743) разложены на 14 модулей
   (сессия браузера / читатели страниц / чистый разбор / фасад), маппинг покрыт спеками.
5. ~~**T-30**~~ — закрыт: `Scheduler.nextRun()` вместо самописного парсера, `shared/cron.ts` удалён.
6. ~~**T-31**~~ — закрыт: README и `architecture.md` приведены к коду, `scripts/` из `tsconfig` убран,
   `env()` сокращён до `userAgent`/`requestDelayMs`.

## V. Ограничения и как проверять

- Живые прогоны `search`/`digest`/`cover`/`apply`/`resume-download` **не выполнялись**: нужны сессия
  hh.ru, ключ ИИ и расход лимита откликов. Всё выше найдено статическим анализом; замена —
  `npx tsc --noEmit`, `npm run arch`, `npm run test:types`, адресные `npx vitest run`, smoke
  `node bin/auto-hh --help`.
- Безопасные для ручной проверки точки: `--help`/`--version`, пункт меню «🧾 Резюме» (list/show),
  `config` (вывод конфига), ветка ошибки `cover` без ключа ИИ, отмена промптов (Ctrl+C).
- Инварианты, которые рефакторинг **не должен** менять: имена env-переменных, схема SQLite
  (`cache_pages`, `cache_full`, `cache_judgements`, `cache_cover_letters`, `history`, `digests`, `resumes`),
  формат `.md`-дайджестов и `data/digests/<дата>/<Регион>/`, тексты меню и `log.*`-сообщений.
- Линт — один раз в конце задачи (`npm run lint`), в промежуточных коммитах достаточно `tsc` и адресных
  тестов (`.clinerules/verification.md`).

