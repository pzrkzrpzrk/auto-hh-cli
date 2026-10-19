# T-17 — `application/apply.ts` за порты: Playwright и MongoDB уходят в адаптеры

- **Приоритет:** **P0** — нарушение Dependency Rule (Clean Architecture, R. C. Martin)
- **Этап:** 8 (первый после архитектурного переезда)
- **Зависимости:** нет — порты `DigestRepository`, `CoverLetterCache`, `HistoryStore` уже существуют
- **Объём:** 1 сценарий (`application/apply.ts`, 102 строки) + новый адаптер + правка `composition`/`cmd-apply`
- **Пути:** актуальные (`src/application`, `src/domain`, `src/infrastructure`), состояние на 2026-10-19

## Проблема

Сценарий отклика — самый «грязный» use case проекта: 6 импортов инфраструктуры на уровне модуля.

| Строка | Импорт | Почему это нарушение |
|---|---|---|
| `application/apply.ts:4` | `playwright/browser` (`openBrowser`, `PROFILE`) | сценарий знает, чем открывается браузер |
| `:6` | `mongo/history-store` (дефолтный синглтон) | обход порта `HistoryStore`, который уже есть |
| `:7` | `mongo/digest-store` | обход порта `DigestRepository`, который уже есть |
| `:8` | `mongo/cache-store` | обход порта `CoverLetterCache`, который уже есть |
| `:10` | `config/apply-config` | настройки читаются в обход зависимостей |
| `:11` | `playwright/apply-steps` | шаги страницы вызываются прямо из сценария |

Следствия:

- сценарий нельзя прогнать без MongoDB и Chromium — поэтому у него нет и не может быть теста;
- `loginFlow()` (`apply.ts:27-33`) — это не бизнес-правило, а инфраструктурный код (`page.goto('https://hh.ru/account/login')` + вечное ожидание), живущий в слое сценариев;
- замена Playwright на HTTP-клиент или Mongo на файлы потребует правки бизнес-логики, то есть ровно того, от чего защищает архитектура;
- `history.load()` (`:78`) вызывается **на каждой итерации цикла** — полная выгрузка коллекции N раз.

## Что сделать

- [x] `domain/ports.ts`: объявить порты по образцу уже существующего `SourceProvider`:
      `ApplicationSession` (`ensureLoggedIn`, `apply(entry)`), `ApplicationGateway`
      (`withSession(fn)` — RAII: открыть браузер → работа → закрыть), `LoginGateway` (`login()`)
      и результат `ApplyResult { ok; reason?; note? }`.
- [x] `infrastructure/playwright/application-gateway.ts`: адаптер над `openBrowser`,
      `ensureLoggedIn`, `applyToVacancy`; `login()` — headful-браузер + `hh.ru/account/login`.
- [x] `application/apply.ts`: `ApplyDeps { digests, letters, history, gateway, login, settings }`,
      сигнатура `runApply(opts, deps)`; удалить все импорты `../infrastructure/*`.
- [x] `history.load()` — один раз до цикла (поведение то же: карта только читается).
- [x] `composition.ts`: `applyDeps` (единственное место сборки) + правка `cmd-apply.ts`.
- [x] `ApplySettings` (`minDelayMs`, `maxDelayMs`) — вход сценария, а не чтение env внутри.

## Definition of Done

- [x] `application/apply.ts` не содержит ни одного импорта `infrastructure/*`.
- [x] `npx tsc --noEmit` → exit 0.
- [x] Поведение не изменилось: тот же порядок «дайджест → отбросить `archived` → лимит → письма →
      проверка логина → цикл», те же сообщения в консоли, та же запись
      `history.markApplied({ via: 'playwright', url })`, `not-logged-in` → `process.exitCode = 1`.
- [x] Браузер закрывается при любом исходе (`finally` в `withSession`), включая `not-logged-in`.

## Проверка

```powershell
npx tsc --noEmit
Select-String -Path src\application\apply.ts -Pattern 'infrastructure|playwright|mongo'
Select-String -Path src\domain\ports.ts -Pattern 'ApplicationGateway|ApplicationSession|LoginGateway'
```

## Риски

- Раньше `ctx.close()` вызывался вручную в двух ветках; теперь закрытие — в `finally` адаптера.
  Нужно убедиться, что при `not-logged-in` процесс завершается (монитор соединения Mongo
  закрывается в `cli/index.ts:run()`).
- Опции `openBrowser` (viewport 1280×800, профиль) менять нельзя: hh.ru чувствителен к отпечатку.
- Ручное подтверждение отклика (`PW_TEST_MODE=manual`) и таймауты остаются в адаптере —
  переносить их в сценарий нельзя, это деталь страницы.

## Реализовано

1. `domain/ports.ts`: `ApplyResult`, `ApplicationSession`, `ApplicationGateway` (`withSession`),
   `LoginGateway` — рядом с `SourceProvider`/`ResumeSource`.
2. `infrastructure/playwright/application-gateway.ts` (новый, 54 строки): `PlaywrightApplicationSession`
   (два действия) + `PlaywrightApplicationGateway` (`withSession` с `finally`, `login()` с headful
   браузером и вечным ожиданием). `HEADLESS` читает сам адаптер.
3. `application/apply.ts` (126 строк): `ApplySettings`, `ApplyDeps`, `loadDigest(type, deps)`,
   `applyAll(session, planned, deps, applied)`; `runApply(opts, deps)` — 0 импортов инфраструктуры.
   `history.load()` вызывается **один раз** до цикла (было — на каждой итерации).
4. `composition.ts`: `applyDeps` (дайджест, письма, история, gateway/login — один объект адаптера,
   паузы из `apply-config`); `cmd-apply.ts` передаёт deps.

### Проверки

- `npx tsc --noEmit` → **exit 0**.
- `Select-String -Path src\application\apply.ts -Pattern 'infrastructure|mongo|playwright|loadConfig'`
  → только комментарии и литерал `via: 'playwright'` (поле истории, инвариант схемы).
- Smoke на фейковых портах (временный `data/tmp-ports-smoke.ts`, удалён), 4 сценария:
  - архивные отброшены (`Недоступных пропущено: 1`), вакансия без письма → `skipped`, одна откликнута
    → `{ ok: 1, fail: 0, skipped: 1 }`, `markApplied` вызван с `meta.via = 'playwright'`;
  - `type: 'all'` идёт через `digests.all()` (`byDate` не вызывается);
  - `ensureLoggedIn → false` → `{ kind: 'not-logged-in' }`;
  - `login: true` → `login()` вызван, `{ kind: 'login' }`.
