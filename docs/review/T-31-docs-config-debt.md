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

- [x] `README.md`: убран `scripts/`, исправлен перечень `files/` и `sqlite/` (`file-janitor`,
      `db-janitor`, `digest-artifacts`), добавлено предупреждение о `data/browser-profile`
      (cookies сессии, не коммитить и не бэкапить).
- [x] `docs/architecture.md`: убран `MONGODB_*` из списка env, обновлены дата, ветка и счётчики
      (183 файла, ≈12,2 тыс. строк, 188 модулей), таблицы названы по SQLite
      (`cache_pages`/`cache_full`), дописан этап 11.
- [x] `tsconfig.json`: `include` — только `src/**/*.ts` (каталога `scripts/` нет).
- [x] `config.ts`: `env()` = `{ userAgent, requestDelayMs }`, `loadConfig()` удалён.
- [x] `mongoUnavailable` → `dbUnavailable` (3 места в `application/resume-download.ts`).
- [x] Убран дубль комментария и лишние пробелы в `presentation/cli/index.ts`.

## Definition of Done

- [x] `npx tsc --noEmit` → exit 0; `npm run test:types` → exit 0; `npm run arch` → 0.
- [x] `Select-String -Path README.md,tsconfig.json,.env.example -Pattern 'MONGODB|scripts/'` → пусто;
      `Select-String -Path docs/architecture.md -Pattern 'MONGODB_|cachePages|cacheFull'` → пусто
      (упоминания Mongo в хронологии этапов остаются).
- [x] `Get-ChildItem src -Recurse -Filter *.ts | Select-String -Pattern 'HH_CLIENT_ID|HH_CLIENT_SECRET|HH_REDIRECT_URI|HH_ACCESS_TOKEN|HH_REFRESH_TOKEN|HH_RESUME_ID|loadConfig'` → пусто.
- [x] `node bin/auto-hh --help` → exit 0; `env()`-поля `userAgent`/`requestDelayMs` читаются
      в `HHPageSession` (smoke без сети: конструктор проверен типами, `search` не запускался).

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
