# T-25 — Разбить адаптеры hh.ru: `client.ts` (619) и `resume.ts` (399)

- **Приоритет:** **P2** — SRP на уровне классов-адаптеров
- **Этап:** 10
- **Зависимости:** нет; делать после T-23 (чтобы правило границ уже проверялось)
- **Объём:** 2 файла → 5–6 модулей, без изменения селекторов
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

`infrastructure/hh/client.ts` — 619 строк и минимум шесть ответственностей:

| Ответственность | Строки |
|---|---|
| инициализация/закрытие браузера | `:214-233` |
| детект и интерактивное решение капчи | `:234-254` |
| чтение SPA-состояния (`readInitialState`, `fetchInitialState`, `dumpState`) | `:255-310` |
| поиск вакансий | `:311-353` |
| карточка вакансии | `:354-382` |
| список/карточка резюме, DOM-fallback | `:383-578` |
| скачивание PDF | `:579-618` |

`infrastructure/hh/resume.ts` — 399 строк разбора страницы резюме (structured-блоки + DOM-fallback).
Оба класса невозможно ни переиспользовать по частям, ни протестировать, ни заменить (API hh.ru
для соискателей закрыт, разметка меняется — править приходится «всё сразу»).

## Что сделать

- [ ] `infrastructure/hh/session.ts`: `HHBrowserSession` — `init/close/isCaptchaPage/solveCaptchaInteractive`,
      `readInitialState/fetchInitialState/dumpState`.
- [ ] `infrastructure/hh/search-page-reader.ts` — `searchVacancies(params)`.
- [ ] `infrastructure/hh/vacancy-page-reader.ts` — `getVacancy(id)`.
- [ ] `infrastructure/hh/resume-page-reader.ts` — `listMyResumes`/`getMyResume` (+ DOM-fallback).
- [ ] `infrastructure/hh/resume-pdf.ts` — `downloadResumePdf`.
- [ ] `resume.ts` → `infrastructure/hh/resume-parser.ts` (чистый разбор, без `Page`) + тонкий адаптер.
- [ ] `vacancy-source.ts`/`resume-source.ts` собирают нужные reader'ы; публичные порты не меняются.

## Definition of Done

- [ ] Ни один файл в `infrastructure/hh` не больше ~200 строк.
- [ ] `npx tsc --noEmit` → exit 0; `npm run arch` → 0.
- [ ] Поведение не изменилось: `search`, `digest`, `cover`, `resume download` используют те же
      селекторы и дают те же данные (проверка — на живом профиле, за владельцем).

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src\infrastructure\hh | Select-Object Name,@{n='Lines';e={(Get-Content $_.FullName).Count}}
```

## Риски

- Любая правка Playwright-кода — риск регресса на живом hh.ru. Переносить **метод в метод**,
  не «улучшая» ожидания, селекторы и таймауты.
- `@ts-nocheck` в клиенте нет (закрыто ранее) — сохранить типизацию при переносе.
