# T-25 — Разбить адаптеры hh.ru: `client.ts` (804) и `resume.ts` (743)

- **Приоритет:** **P2** — SRP на уровне классов-адаптеров
- **Этап:** 10
- **Зависимости:** нет; делать после T-23 (чтобы правило границ уже проверялось)
- **Объём:** 2 файла → 14 модулей, без изменения селекторов
- **Пути:** актуальные, состояние на 2026-10-28 (после T-26/T-28)

## Проблема

`infrastructure/hh/client.ts` — 804 строки и минимум шесть ответственностей:

| Ответственность | Строки |
|---|---|
| инициализация/закрытие браузера | `:282-300` |
| детект и интерактивное решение капчи | `:302-320` |
| чтение SPA-состояния (`readInitialState`, `fetchInitialState`, `dumpState`) | `:322-380` |
| поиск вакансий | `:382-419` |
| карточка вакансии | `:421-448` |
| список/карточка резюме, DOM-fallback | `:450-757` |
| скачивание PDF | `:759-801` |

`infrastructure/hh/resume.ts` — 743 строки разбора страницы резюме (structured-блоки + DOM-fallback).
Оба класса невозможно ни переиспользовать по частям, ни протестировать, ни заменить (API hh.ru
для соискателей закрыт, разметка меняется — править приходится «всё сразу»).

## Что сделать

- [x] `infrastructure/hh/session.ts`: `HHPageSession` + порт `PageFetcher` — `init/close/ensureOpen/
      isCaptchaPage/solveCaptchaInteractive`, `readInitialState/fetchInitialState/dumpState`,
      `LoginRequiredError`.
- [x] `infrastructure/hh/search-page-reader.ts` — `HHVacancySearchReader.searchVacancies(params)`.
- [x] `infrastructure/hh/vacancy-page-reader.ts` — `HHVacancyPageReader.getVacancy(id)`.
- [x] `infrastructure/hh/resume-page-reader.ts` — `listMyResumes`/`getMyResume` (+ DOM-fallback).
- [x] `infrastructure/hh/resume-dom-blocks.ts` — браузерный скрипт разбора DOM (`collectResumeBlocks`).
- [x] `infrastructure/hh/resume-pdf.ts` — `downloadResumePdf(session, hash, destPath)`.
- [x] `resume.ts` → чистый разбор без `Page`: `resume-raw.ts` (JSON-доступ), `resume-codes.ts`
      (словари кодов), `resume-lookup.ts` (поиск резюме и справочники), `resume-sections.ts`
      (блоки резюме), `resume-parser.ts` (модель, слияние, пустота).
- [x] Маппинг вакансий вынесен отдельно и стал чистым: `vacancy-fields.ts` + `vacancy-mapping.ts`.
- [x] `client.ts` (52 строки) — тонкий фасад: сессия + читатели; `vacancy-source.ts`/`resume-source.ts`
      и публичные порты не менялись.
- [x] Спеки на перенесённую логику: `tests/hh-vacancy-mapping.spec.ts` (9),
      `tests/hh-resume-parser.spec.ts` (12), `tests/hh-page-readers.spec.ts` (7).

## Definition of Done

- [x] Ни один файл в `infrastructure/hh` не больше ~200 строк (максимум — `resume-dom-blocks.ts`, 199).
- [x] `npx tsc --noEmit` → exit 0; `npm run arch` → 0 (189 модулей, 702 зависимости);
      `npm run test:types` → exit 0; полный `npx vitest run` → 22 файла / 131 тест.
- [x] Поведение не изменилось на уровне кода: тела методов и селекторы перенесены дословно
      (проверено сравнением значимых строк старых файлов с новыми модулями — расходятся только
      `export`/`readonly` и убранный реэкспорт типов). Живой прогон `search`/`digest`/`cover`/
      `resume download` не выполнялся — нужен профиль hh.ru (за владельцем).

## Проверка

```powershell
npx tsc --noEmit
npm run arch
npm run test:types
npx vitest run tests/hh-vacancy-mapping.spec.ts tests/hh-resume-parser.spec.ts tests/hh-page-readers.spec.ts --reporter=dot
Get-ChildItem src\infrastructure\hh | Select-Object Name,@{n='Lines';e={(Get-Content $_.FullName).Count}}
```

## Риски

- Любая правка Playwright-кода — риск регресса на живом hh.ru. Переносить **метод в метод**,
  не «улучшая» ожидания, селекторы и таймауты.
- `@ts-nocheck` в клиенте нет (закрыто ранее) — сохранить типизацию при переносе.
- DOM-скрипт резюме теперь передаётся в `page.evaluate` именованной функцией
  (`pageScript(collectResumeBlocks)`): строка функции не изменилась, обёртка `__name` та же,
  но проверить это можно только на живой странице hh.ru.

