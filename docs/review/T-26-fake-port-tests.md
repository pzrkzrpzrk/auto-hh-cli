# T-26 — Тесты на фейковых портах (vitest)

- **Приоритет:** **P2** — без тестов архитектура не даёт своей главной выгоды
- **Этап:** 10
- **Зависимости:** T-17, T-18, T-19 (сценарии должны принимать зависимости, а не импортировать их)
- **Объём:** расширение каталога `tests/`, ~40 тестов
- **Пути:** актуальны на 2026-10-28
- **Статус:** ✅ сделано по сценариям и SQLite; открытыми остались адаптеры hh.ru (уйдут в T-25)
- **История:** тикет писался, когда тестов не было вовсе и планировался `node:test`; сейчас стек —
  vitest (`vitest.config.mts`, `tests/**/*.spec.ts`), поэтому первый пункт закрыт по-другому.

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

- [x] Тестовый раннер — `vitest` (`tests/**/*.spec.ts`, алиас `@/` из `vitest.config.mts`); отдельный
      npm-скрипт `test` не нужен: проверки идут адресно (`npx vitest run tests/<файл>`).
- [x] `tests/digest-policy.spec.ts`, `tests/judge-verdict.spec.ts`, `tests/cover-*` (**T-27**):
      доменные правила дайджеста, вердикт судьи, шаблон и сигнатура письма.
- [x] `tests/actualize.spec.ts`, `tests/reset-summary.spec.ts`: `computeActualization` на фикстурах дат,
      формат сводки сброса.
- [x] `tests/search-scenario.spec.ts`: `SearchScenario` на фейковых портах — страницы и дедуп в файле,
      полные карточки, пустая выдача, страница 0 при заполненном кэше, пропуск просмотренных, reset.
- [x] `tests/digest-scenario.spec.ts`: `DigestScenario` — пустой кэш и пустая выдача, сборка без ИИ
      (запись `rejected`+`digest`, отметки `digestOnly`), dry-run, лимит, локальный фильтр.
- [x] `tests/cover-scenario.spec.ts`: `CoverScenario` — нет резюме, пустой дайджест, письма из кэша,
      `force`, отсутствие описаний, лимит.
- [x] `tests/apply-scenario.spec.ts`: `ApplyScenario` — `not-logged-in`, пропуск без письма,
      `applied`/`digestOnly`, архивные, лимит, отказ и исключение сессии, `--login`, выбор резюме, `--type all`.
- [x] `tests/{cache,digest,history}-store.spec.ts`: адаптеры SQLite на `:memory:` — снимок кэша,
      выборка дайджеста с legacy-fallback, `markSeen` не затирает `applied`.
- [ ] Адаптеры hh.ru (разбор выдачи, карточки и резюме) — фикстурами займётся **T-25**, там же
      появятся спеки на маппинг без браузера.

## Definition of Done

- [x] Проверки зелёные без Mongo/Playwright/ключа ИИ: `vitest` — 19 файлов / 103 теста.
- [x] Тесты сценариев не импортируют `infrastructure/*`: все порты заменены фейками в самих спеках.
- [x] `npx tsc --noEmit` → exit 0, `npm run test:types` → exit 0 (у тестов свой `tsconfig`).

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
