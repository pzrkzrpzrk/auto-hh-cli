# T-26 — Тесты на фейковых портах (`node:test` + `tsx`)

- **Приоритет:** **P2** — без тестов архитектура не даёт своей главной выгоды
- **Этап:** 10
- **Зависимости:** T-17, T-18, T-19 (сценарии должны принимать зависимости, а не импортировать их)
- **Объём:** новый каталог `tests/`, npm-скрипт, ~10 тестов
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

В репозитории **нет ни одного теста** (`tests/`, `*.test.ts`, `*.spec.ts` отсутствуют), нет
`test`-скрипта в `package.json`. Единственная автопроверка — `npx tsc --noEmit`.

При этом самая чистая часть проекта готова к тестам уже сейчас:

- `DigestDeps` (`application/digest/DigestDeps.ts:17-36`) состоит только из портов;
- `SearchDeps` (`domain/ports.ts:35-37`) — то же;
- доменные правила — чистые классы (`DigestFilter`, `DigestMatcher`, `computeActualization`,
  `SearchQuery`, `normalizeVerdict`).

Мешают только глобали: `loadConfig()` внутри сценариев (T-19) и `process.env` в домене (T-21).
Из-за этого `docs/architecture.md:462` фиксирует тесты как «идею», а не как план.

## Что сделать

- [ ] `package.json`: `"test": "node --test --import tsx tests/**/*.test.ts"` (или `tsx --test`).
- [ ] `tests/domain/digest-filter.test.ts`: `matches` — архив, компании, ключевые слова, зарплата,
      удалёнка/регион; `select` — карточки отсутствуют/есть.
- [ ] `tests/domain/digest-matcher.test.ts`: лимит `maxRun`, отсутствие вердикта → шаблон,
      `fit=false` → `rejected` с причиной.
- [ ] `tests/domain/actualize.test.ts`: `computeActualization` / `mergeActualized` на фикстурах дат.
- [ ] `tests/domain/judge.test.ts`: `normalizeVerdict` — инвариант `fit ⇒ comment≠null, reason=null`.
- [ ] `tests/application/digest-scenario.test.ts`: `DigestScenario` на фейковых портах
      (`CacheStore`, `DigestRepository`, `JudgementCache`, `AiProvider`) — сценарии:
      пустой кэш, пустая выдача, dry-run без записей, батч-фолбэк.
- [ ] `tests/application/apply.test.ts` (после T-17): `runApply` на фейковом `ApplicationGateway` —
      `not-logged-in`, пропуск `digestOnly`, лимит, `archived`.
- [ ] `tests/application/cover.test.ts` (после T-18): `runCover` — нет резюме, пустой дайджест,
      письма уже есть, `force`.

## Definition of Done

- [ ] `npm test` → зелёный, без Mongo/Playwright/ключа ИИ.
- [ ] Тест на `apply`/`cover` не импортирует `infrastructure/*` (фейки лежат в `tests/fakes/`).
- [ ] `npx tsc --noEmit` → exit 0 (тесты включены в `tsconfig` или отдельный `tsconfig.test.json`).

## Проверка

```powershell
npm test
npx tsc --noEmit
```

## Риски

- `tsx` уже в `dependencies` — новых зависимостей не нужно.
- Тесты не должны требовать `data/`: все пути и файлы — через порты/фейки.
- Не переносить в тесты бизнес-логику: если правило трудно проверить без 20 моков, значит
  зависимость ещё не развязана (возврат к T-17…T-22).
