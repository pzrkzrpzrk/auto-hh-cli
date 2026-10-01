# T-12 — `cmd-apply.ts`: распил, единый запуск браузера, дубли

- **Приоритет:** P1 — REVIEW.md § II **K2** + § I **D14** (P1) и **D12** (P2)
- **Этап:** 4
- **Зависимости:** T-07 (`history.isApplied` вместо `history.load()` в цикле)
- **Объём:** 303 строки → модули; 3 запуска Chromium → 1 хелпер

## Проблема

### K2 — два «бога» в одном файле

- `apply()` — `src/cli/cmd-apply.ts:228-302` (75 строк)
- `applyToVacancy()` — `:33-168` (136 строк), вложенность: проверка отклика → логин → нажатие кнопки →
  заполнение письма → тест → ручное подтверждение → случайная задержка.

### D12 — дубли внутри `applyToVacancy`

- `PW_MIN_DELAY_MS` / `PW_MAX_DELAY_MS` парсятся **дважды**: `:12-13` и повторно `:35-36` (то есть внутри
  цикла по вакансиям);
- блок «test required» — дважды: `:70-83` и `:152-164`;
- `detectPostState` вызывается дважды с одинаковым разбором результата.

### D14 — запуск Chromium и профиль продублированы

- `PROFILE` объявлен дважды: `src/cli/cmd-apply.ts:10` и `src/clients/hh-client.ts:13`;
- `chromium.launchPersistentContext(...)` с одинаковыми опциями: `cmd-apply.ts:219-222`, `:255-258`,
  `src/clients/hh-client.ts:96-99`;
- `ctx.pages()[0] || await ctx.newPage()` — `cmd-apply.ts:223` и `:259`, `hh-client.ts:101`;
- `ensureProfile()` (`cmd-apply.ts:20-22`) существует только потому, что `cmd-apply` не использует `HhClient`.

## Что сделать

- [ ] Новый `src/browser.ts`: `PROFILE` (один экспорт) + `openBrowser({ headless })` →
      `{ ctx, page, close }` с едиными опциями запуска и `pages()[0] || newPage()`.
- [ ] `src/clients/hh-client.ts` и `src/cli/cmd-apply.ts`: перейти на `openBrowser`;
      `ensureProfile()` удалить или перенести в `browser.ts` как часть `openBrowser`.
- [ ] `cmd-apply.ts`: `PW_MIN/MAX_DELAY_MS` читать через `intFromEnv` (T-04) **на уровне модуля**, убрать
      повторный парсинг на `:35-36`.
- [ ] `cmd-apply.ts`: вынести `handleTestRequired(page)`, `ensureDraftSubmitted(page)`, `ensureLoggedIn(page)`,
      `findResponseButton(page)`, `fillLetter(page, text)`, `waitForManualSubmit(page)`.
- [ ] `applyToVacancy` после распила — не более ~40 строк, читается как последовательность шагов.
- [ ] `detectPostState` вызывать один раз на итерацию, результат передавать дальше.
- [ ] `history.load()` в цикле заменить на `history.isApplied(id)` — если это не сделано в T-07.

## Definition of Done

- [ ] Один литерал `launchPersistentContext` в проекте, один `PROFILE`.
- [ ] `cmd-apply.ts` разбит на модули ≤ ~150 строк (например `cli/apply/*.ts`), публичный вход не изменился
      (меню вызывает ту же функцию).
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] Поведение отклика не изменилось: ручной прогон на 1-2 вакансиях в тестовом профиле — те же нажатия,
      те же сообщения в консоли, те же записи в `history` и `cacheCoverLetters`.

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src -Recurse -Include *.ts | Select-String -Pattern 'launchPersistentContext|PROFILE|process\.env\.PW_'
```

## Риски

- Это самый рискованный тикет: логика Playwright завязана на тайминги, селекторы и ручные подтверждения.
  Рекомендуется делать **последним из P1**, отдельными коммитами: сначала `openBrowser` (механика),
  затем чистка дублей внутри `applyToVacancy`, затем распил на модули.
- Изменение опций запуска (например `headless` или `viewport`) недопустимо: hh.ru чувствителен к отпечатку
  профиля, и это уже отлажено.
- `ensureProfile()` удалять только после того, как `openBrowser` создаёт каталог профиля сам (проверить
  запуск при отсутствующем `data/browser-profile`).
