# Clean Architecture · паттерны · KISS/DRY

Это **правила**, как устроен код. Описание того, что уже сделано, и хронология этапов —
[`docs/architecture.md`](../docs/architecture.md); актуальный список долга — [`REVIEW.md`](../REVIEW.md).
Границы слоёв проверяются автоматически: `npm run arch` (`.dependency-cruiser.js`, нарушение = exit ≠ 0).

## 1. Слои и направление зависимостей

| Слой | Может импортировать | Запрещено |
| --- | --- | --- |
| `src/domain` | `shared` | `infrastructure`, `application`, `presentation`, node built-ins, env, ИИ, логгер-адаптер |
| `src/application` | `domain`, `shared`, порты | `infrastructure`, `presentation`, `composition`, node built-ins |
| `src/infrastructure` | `domain` (реализует порты), `shared` | `application`, `presentation` |
| `src/presentation` | `application`, `composition`, `shared` | `domain`, `infrastructure` |
| `src/shared` | ничего из слоёв | `domain`, `application`, `infrastructure`, `presentation` |
| `src/composition.ts` | все слои | — (единственное место сборки) |

- **Тип-импорт тоже зависимость** (`tsPreCompilationDeps: true`): `import type { X } from "@/infrastructure/..."` нарушает правило так же, как обычный импорт. Нужен тип — объяви DTO/порт в `domain`.
- **Циклы запрещены** (`no-circular`): если два модуля «дружат» — выдели третий (VO, порт, событие).
- **Нужен внешний эффект — нужен порт.** Порядок: интерфейс в `domain/ports.ts` (или `domain/<подпакет>/ports.ts`) → адаптер в `infrastructure/<...>` → сборка в `composition.ts` → фейк в тесте. Сценарий правится только на использование порта.
- **Направление передачи зависимостей:** `deps` приходят параметром (`runX(opts, deps)`), а не импортом из `composition`. Импорт `composition` из `application` запрещён отдельным правилом.
- **`presentation` получает DTO печати из `application`** (реэкспорт), а не из `domain` — так CLI не тянет бизнес-правила.

Быстрая проверка (PowerShell):

```powershell
npm run arch
Get-ChildItem src/application,src/presentation -Recurse -Filter *.ts | Select-String -Pattern 'from "@/infrastructure'
Get-ChildItem src/domain -Recurse -Filter *.ts | Select-String -Pattern 'process\.env|from "node:|from "fs"|from "path"'
Get-ChildItem src/presentation -Recurse -Filter *.ts | Select-String -Pattern 'from "@/domain'
```

## 2. Как устроен сценарий (`application/<шаг>`)

Эталон — `application/apply/` и `application/cover/`. Новый шаг повторяет раскладку:

| Файл | Роль |
| --- | --- |
| `<X>Scenario.ts` | Facade: единственная точка входа `run(opts)` |
| `<X>Pipeline.ts` + `<X>Stage.ts` | Chain of Responsibility + Template Method (`включена → execute → onError`) |
| `stages.ts` | состав и порядок стадий, ранние выходы |
| `<X>Context.ts` | мутируемое состояние прогона между стадиями |
| `<X>Deps.ts` | порты, которые нужны шагу (никаких адаптеров) |
| `<X>Event.ts` / `Reporter` | события для presentation вместо `console.log` |
| `index.ts` | публичный экспорт подпакета |
| `application/<шаг>.ts` | совместимый фасад `run<X>(opts, deps)` для команды |

Правила шага:

- **Оркестрация — в `application`, печать — в `presentation`.** `console.*` в `application`/`domain` запрещён; для прогресса — событие + репортёр (`presentation/cli/format/*`). Логи `log.*` допустимы там, где они уже были (тексты — инвариант).
- **Ошибки — не `process.exit`.** Сценарий возвращает outcome-union (`{ kind: 'done' | 'empty' | 'error', ... }`) или бросает; код возврата выставляет команда (`process.exitCode`). `process.exit(` в `src/` запрещён.
- **Стадия = один шаг сценария.** Новая стадия добавляется в `stages.ts`, а не в середину `execute`; текст её лога фиксируется тестом/ревью.
- **Время, случайность, ретраи — параметром** (`shared/time.ts`, `shared/retry.ts`), чтобы тест шёл без пауз (`NoPacing`).

## 3. Паттерны: когда какой брать

| Паттерн | Живой пример | Когда |
| --- | --- | --- |
| Ports & Adapters (DIP) | `domain/ports.ts` + `infrastructure/playwright/application-gateway.ts` | любой внешний эффект (сеть, БД, файлы, браузер, ИИ, env) |
| Facade | `ApplyScenario`, `CoverScenario`, `DigestScenario` | команде нужен один `run()`, а внутри план и конвейер |
| Template Method | `ApplyStage`, `CoverStage`, `DigestStage`, `SearchStage` | одинаковый каркас стадии, разные тела |
| Chain of Responsibility | `*Pipeline` + `stages.ts`, `SkipRules` | порядок шагов и ранний выход важнее «универсальности» |
| Strategy | `CoverMode`, `DigestSelection`, `Pacing`, `JudgeStrategy`, `FullCardPolicy`, `ActualizeTarget` | ветвление по режиму: новый режим = новый класс, а не `if` |
| Null Object | `NoPacing` | заглушка для тестов вместо `if (deps.pacing)` |
| Value Object | `Verdict`, `CoverSignature`, `CoverTemplate`, `CoverSettings`, `ApplySummary`, `CoverPlan`, `SearchQuery` | инвариант + арифметика/формат в одном месте |
| Domain Service | `DigestFilter`, `DigestMatcher`, `DigestEntryFactory`, `JudgePrompt`, `CoverLetterPrompt` | правило без I/O и без состояния |
| Application Service | `VacancyCollector`, `JudgeService`, `CoverLetterService`, `DigestJudgeRunner` | I/O через порты, пачки, ретраи, диагностика |
| Factory + RAII | `HHSourceProvider`, `gateway.withSession` | открыть/закрыть ресурс в одном месте (`finally`) |
| Repository | `SqliteDigestRepository`, `SearchCache` | доступ к данным методами, а не к «коллекциям» |
| Observer / Reporter | `ConsoleDigestReporter`, `SearchReporter` | вывод отделён от сценария |
| Iterator / Builder | `PageIterator`, `SearchRequestBuilder` | обход страниц и сборка параметров запроса |

**KISS-ограничение на паттерны:** новый слой абстракции вводится, только если он убирает ветвление
или вторую копию кода. Один `if` по флагу — это `if`, а не Strategy; один вызов без вариаций — это
функция, а не Facade.

## 4. Где что лежит

- Правила, инварианты, промпты, форматы — `domain/` (VO, Domain Service). Тексты промптов переносятся **дословно**.
- Вызовы ИИ, пачки (`chunk`/`runBatches`), ретраи, `try/catch`, логи — `application/*Service.ts`.
- env и `config.json` читает только `infrastructure/config/*` (за портом `ConfigProvider`); сценарии получают готовые VO (`CoverSettings`, `DigestPolicy.from(config)`), а не env.
- Файлы, SQLite, Playwright, HTTP — только `infrastructure/`; JSON-колонки — через `infrastructure/sqlite/rows.ts`.
- Печать и меню — `presentation/cli/`; формат отчётов — `presentation/cli/format/`.
- Пути (`DATA_DIR`, `LOG_FILE`), время (`sleep`, `rand`, `dateKey`), батчи, текст, ошибки — `shared/`.

## 5. KISS

- **Одна причина изменения на модуль.** > 200 строк — повод разделить по ответственности; > 300 — разделить обязательно. Известные исключения и их тикеты: `infrastructure/hh/client.ts` (737) и `hh/resume.ts` (664) — T-25.
- **Никаких флагов-переключателей вместо стратегии.** `skipSeen: boolean` → `FullCardPolicy`; «батч или поштучно» → `JudgeStrategy`.
- **До 4 параметров у функции.** Больше — объект/VO (`CoverSettings`, `DigestPolicy`), а не `(a, b, c, d, e, f, g)`.
- **Ранний выход вместо вложенности.** Глубина > 3 — раздели на функции; `try/catch` — только там, где есть решение, что делать с ошибкой.
- **`process.exit(` в `src/` запрещён** (кроме комментариев): падает `finally`, не закрывается SQLite, меню теряет пользователя. Только `process.exitCode = 1` в `presentation`.
- **Мёртвый код удаляется сразу:** недостижимые ветки, «совместимые» алиасы без вызовов, экспорт без потребителей, закомментированные блоки. Проверка — поиск по имени символа во всём `src/`.
- **`any` не добавляем.** На границе с внешним миром — `type Raw* = Record<string, unknown>` + разбор, на выходе VO. Существующий долг — не повод тиражировать (см. `REVIEW.md`, R7).

## 6. DRY

- **Вторая копия — повод вынести, третья — обязанность.** Куда: нет бизнес-смысла → `shared/`; есть правило → `domain/` (Domain Service/VO); доступ к данным → Repository.
- **Сначала ищи готовое:**

| Нужно | Бери |
| --- | --- |
| JSON-ответ модели | `shared/text-utils.ts` → `parseJSON` |
| пачки и параллелизм | `shared/batches.ts` → `chunk`, `runBatches` |
| пауза, случайность, дата | `shared/time.ts` → `sleep`, `rand`, `dateKey` |
| ретраи с `Retry-After` | `shared/retry.ts` |
| текст ошибки/имя ошибки | `shared/errors.ts` |
| ЗП, форматирование | `shared/format.ts` → `fmtSalary` |
| строки SQLite ↔ домен | `infrastructure/sqlite/rows.ts` |
| догрузка полных карточек | `VacancyCollector.ensureFullCards` |
| письма из кэша в записи | `CoverLetterCache.attach` |
| запись дайджеста | `DigestEntryFactory` |
| env-числа и флаги | `infrastructure/config/env.ts` → `intFromEnv`, `boolFromEnv` |
| пути данных | `infrastructure/config/paths.ts` |

- **Формат строки лога — один** (`shared/logger.ts` + адаптер `infrastructure/logging/logger.ts`); не копируй шаблон времени/JSON-meta в новый модуль.
- **«Совместимая обёртка» живёт с датой и тикетом.** Реэкспорт `fmtSalary` в `application/collect.ts` — пример допустимого фасада; бессрочных обёрток «на всякий случай» не заводим.

## 7. SOLID — короткие маркеры

- **SRP.** Не можешь назвать обязанность файла одним предложением без «и» — дели.
- **OCP.** Новый режим/формат = новый класс-стратегия; правка `if` в сценарии ради режима — сигнал, что нужна Strategy.
- **LSP.** Фейковый порт ведёт себя как настоящий: те же ошибки, пустые ответы, отмены. Иначе тест врёт.
- **ISP.** Порт — узкий (`CacheStore` ≠ «всё хранилище»). Растущий интерфейс делить по потребителям.
- **DIP.** Зависимость на интерфейс из `domain`; конкретный класс знает только `composition.ts`.

## 8. Что проверить перед коммитом

| Изменение | Минимум |
| --- | --- |
| новый файл, новый импорт, смена слоя | `npm run arch` (всегда) |
| `domain/**` | `npx tsc --noEmit` + grep на `AiProvider`, `ai.chat(`, `logger`, `process.env`, `fs`, `path` + спеки правил |
| `application/**` | `npx tsc --noEmit` + `npm run arch` + спеки сценария/стадии |
| `infrastructure/**` | `npx tsc --noEmit` + `npm run arch` + спек адаптера на `:memory:`/tmp |
| `presentation/**` | `npx tsc --noEmit` + `node bin/auto-hh --help` |
| рефакторинг дубля | grep по имени вынесенной функции: не осталось копий |
| конец задачи | `npm run lint` один раз |

Команды и запреты — в [`verification.md`](verification.md): только они, без `npm run build`, живых прогонов и самодельных линтеров.

## 9. Запрещено без отдельного тикета

- Импорт `infrastructure` из `application`/`presentation`; импорт `domain` из `presentation`; любая связь из `shared`.
- Бизнес-логика в `presentation/cli/commands/*`: команда выбирает действие, собирает опции и печатает.
- Печать (`console.*`) и файловый I/O в `domain`/`application`.
- `process.exit(` в `src/`; исключение — только `process.exitCode` в `presentation`.
- Новые зависимости «ради удобства», если нужное уже есть в `shared/`; Mongo, jest, Vue, Prettier и прочие стеки, которых нет в `package.json`.
- Изменение инвариантов: имена env, таблицы SQLite, формат `.md`-дайджеста, тексты меню и `log.*`-сообщений.
- `@ts-ignore` / `@ts-nocheck` / `as any` в новом коде.

## 10. Известный долг (не тиражировать)

Актуальный список — [`REVIEW.md`](../REVIEW.md), тикеты — [`docs/review/`](../docs/review/README.md).

| Что | Почему важно | Тикет |
| --- | --- | --- |
| `hh/client.ts` (737) и `hh/resume.ts` (664) | SRP адаптеров, 46 `any` на двоих | T-25 |
| `shared/cron.ts` — самописный парсер | ошибки на диапазонах и day-of-week | T-30 |
| дрейф документации и `env()` с OAuth-полями | README/`architecture.md` описывают несуществующее | T-31 |

Новый код не должен повторять эти образцы: чистка идёт по тикетам, а не «заодно» в чужой правке.


