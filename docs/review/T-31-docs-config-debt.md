# T-31 — документация и мёртвая конфигурация

- **Приоритет:** **P2** — документация расходится с кодом, `env()` отдаёт неиспользуемые поля
  (R4 и R5 в [`REVIEW.md`](../../REVIEW.md))
- **Этап:** 11
- **Зависимости:** нет
- **Объём:** `README.md`, `docs/architecture.md`, `tsconfig.json`, `infrastructure/config/config.ts`,
  мелкие переименования
- **Пути:** актуальны на 2026-10-28

## Проблема

Документация и конфигурация описывают дерево до миграции на SQLite:

| Место | Написано | По факту |
|---|---|---|
| `README.md:448` | `scripts/` с «judge-only, fill-cover-letters» | каталога нет (и `tsconfig.json:19` зря включает `scripts/**/*.ts`) |
| `README.md:439` | `files/: …, data-janitor, …` | файла `data-janitor.ts` нет; есть `file-janitor.ts`; не упомянуты `sqlite/db-janitor.ts`, `files/digest-artifacts.ts` |
| `docs/architecture.md:700` | env-переменные `MONGODB_*` | Mongo в проекте нет (0 совпадений в `.env.example`, `README.md`, `src/`) |
| `docs/architecture.md:702` | «MongoDB: коллекции `cachePages`, `cacheFull`, …» как актуальное состояние | таблицы SQLite `cache_pages`, `cache_full`, … (`infrastructure/sqlite/schema.ts`) |
| `docs/architecture.md:4-6` | дата 2026-10-19, ветка `refactor/t24-domain-purity`, 154 файла, ≈10,26 тыс. строк | 2026-10-28, `development`, 166 файлов, 10 559 строк |
| `README.md:350,379` | профиль Chromium описан как данные | нет предупреждения: профиль содержит cookies сессии и не подлежит бэкапу/публикации |
| `infrastructure/config/config.ts:70-81` | `env()` отдаёт 8 полей | используются два: `userAgent` и `requestDelayMs` (`hh/client.ts:262-264`); `clientId/clientSecret/redirectUri/accessToken/refreshToken/resumeId` не читаются нигде |
| `infrastructure/config/config.ts:65-68` | экспорт `loadConfig()` | не импортируется ни одним модулем (`composition.ts:19` берёт `configProvider`) |

Плюс мелочи из R8: `application/resume-download.ts:102,154,160` — переменная `mongoUnavailable`;
`presentation/cli/index.ts:1-2` — один и тот же комментарий дважды, `:5` — `import {  Command  }`
с двойными пробелами.

## Что сделать

- [ ] `README.md`: убрать `scripts/`, исправить перечень `files/`, добавить предупреждение
      о `data/browser-profile` (cookies, не коммитить и не бэкапить).
- [ ] `docs/architecture.md`: убрать `MONGODB_*` из списка env, обновить дату, ветку и счётчики
      файлов/строк (или заменить их ссылкой на `Get-ChildItem`-команду).
- [ ] `tsconfig.json`: убрать `scripts/**/*.ts` из `include` (либо создать каталог — но его нет).
- [ ] `config.ts`: оставить `env()` = `{ userAgent, requestDelayMs }`, `loadConfig()` удалить.
- [ ] Переименовать `mongoUnavailable` → `dbUnavailable` (3 места).
- [ ] Убрать дубль комментария и лишние пробелы в `presentation/cli/index.ts`.

## Definition of Done

- [ ] `npx tsc --noEmit` → exit 0.
- [ ] `Select-String -Path README.md,tsconfig.json,.env.example -Pattern 'MONGODB|scripts/'` → пусто;
      `Select-String -Path docs/architecture.md -Pattern 'MONGODB_|cachePages'` → пусто (упоминания
      Mongo в хронологии этапов остаются).
- [ ] `Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'HH_CLIENT_ID|HH_CLIENT_SECRET|HH_REDIRECT_URI|HH_ACCESS_TOKEN|HH_REFRESH_TOKEN'` → пусто.
- [ ] `node bin/auto-hh --help` → exit 0; `env()`-поля `userAgent`/`requestDelayMs` работают
      (smoke: `search` не запускаем, проверяем чтение в `HHClient` конструктором в тесте или ревью кода).

## Проверка

```powershell
npx tsc --noEmit
Select-String -Path README.md,tsconfig.json,.env.example -Pattern 'MONGODB|scripts/'
Select-String -Path docs/architecture.md -Pattern 'MONGODB_|cachePages'
Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'HH_CLIENT_ID|HH_CLIENT_SECRET|HH_REDIRECT_URI|HH_ACCESS_TOKEN|HH_REFRESH_TOKEN'
node bin/auto-hh --help
```

## Риски

- Удаление OAuth-полей не меняет поведение (они не читались), но если владелец планирует вернуть
  OAuth-вход — сначала тикет, потом удаление. Сейчас OAuth-кода в проекте нет.
- Документация: не переписывать разделы про Mongo в хронологии этапов (`docs/architecture.md`,
  этапы 6–8) — это история; правится только актуальная часть и env-таблица.
