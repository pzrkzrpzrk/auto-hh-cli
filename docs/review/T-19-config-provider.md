# T-19 — `ConfigProvider` вместо `loadConfig()` в сценариях и `process.env.CONFIG_PATH`

- **Приоритет:** **P0** — скрытая зависимость + глобальное состояние
- **Этап:** 8
- **Зависимости:** T-18 (там `loadConfig` уже вынесен в `CoverConfig` для одного сценария)
- **Объём:** `domain/ports.ts` (порт), `infrastructure/config/config.ts` (адаптер), 4 сценария, `composition`
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

1. **Инфраструктурный импорт в сценариях**: `DigestScenario.ts:4-5`, `ActualizeScenario.ts:4`,
   `SearchScenario.ts:3`, `cover.ts:6-7`, `schedule.ts:4`.
2. **Мутация process-wide переменной** вместо параметра:

   | Файл | Строка |
   |---|---|
   | `application/digest/DigestScenario.ts` | `:68` |
   | `application/digest/ActualizeScenario.ts` | `:24` |
   | `application/search/SearchScenario.ts` | `:30` |

   `if (opts.config) process.env.CONFIG_PATH = opts.config;` затем `loadConfig()` **внутри** сценария
   читает файл. По сигнатуре метода не видно, что поведение зависит от диска и от порядка вызовов:
   два прогона в одном процессе делят это состояние, тесты — тоже.
3. `loadConfig()` не мемоизирован: `cover.ts` читает файл 3 раза за прогон, `DigestScenario` — 1 раз,
   но на каждый вызов `build()`.

## Что сделать

- [x] `domain/ports.ts`: порт `ConfigProvider { load(path?: string): AppConfig }`
      (`AppConfig` — тип, вынесенный из `config.ts`, без fs внутри).
- [x] `infrastructure/config/config.ts`: `FileConfigProvider implements ConfigProvider`,
      мемоизация по `absPath`, явный параметр `path` вместо чтения `process.env.CONFIG_PATH`
      в глубине (env остаётся дефолтом для адаптера).
- [x] Сценарии (`DigestScenario`, `ActualizeScenario`, `SearchScenario`, `schedule`, `cover`):
      получать `cfg`/`CoverConfig` из deps; удалить присваивания `process.env.CONFIG_PATH`.
      `opts.config` передаётся в `deps.config.load(opts.config)`.
- [x] `composition.ts`: один `configProvider` на процесс; `coverConfig()` и `digestDeps` используют его.
- [x] CLI: `opts.config` остаётся внешним контрактом (`--config`) — меняется только способ доставки.

## Definition of Done

- [x] `Get-ChildItem src\application -Recurse -Filter *.ts | Select-String -Pattern 'process\.env\.CONFIG_PATH\s*='` → пусто.
- [x] `Get-ChildItem src\application -Recurse -Filter *.ts | Select-String -Pattern 'config/config'` → пусто.
- [x] `npx tsc --noEmit` → exit 0.
- [x] Поведение не изменилось: `opts.config` по-прежнему позволяет указать другой файл для одного прогона;
      параллельные прогоны в одном процессе больше не влияют друг на друга.

## Выполнено (2026-10-19)

- `domain/ports.ts` — `AppConfig` (DTO config.json: `api`, `apply`, `adaptResume`, `search`,
  `filter`, `schedule` + неизвестные ключи) и `ConfigProvider { load(path?) }`; `SearchDeps.config`
  добавлен к хранилищам и источнику.
- `infrastructure/config/config.ts` — `FileConfigProvider`: явный путь важнее `CONFIG_PATH`,
  `path.resolve` и `Map<absPath, AppConfig>`; `configProvider` — один экземпляр на процесс,
  `loadConfig(path?)` оставлен совместимой обёрткой для `cmd-config`.
- `DigestDeps`/`ActualizeDeps`/`ScheduleDeps` получили `config: ConfigProvider`;
  `CoverDeps.config` принимает путь. `DigestScenario`, `ActualizeScenario`,
  `SearchScenario`, `schedule` и `CoverScenario` читают конфиг только через deps и передают
  `opts.config`; присваиваний `process.env.CONFIG_PATH` в `application` нет.
- `composition.ts` — `searchDeps`, `digestDeps`, `actualizeDeps`, `coverConfig` и `aiProvider`
  используют общий `configProvider`; `cmd-schedule` получает его из composition.
- `aiProvider(path?)` и `DigestDeps.ai`/`CoverDeps.ai` принимают путь: альтернативный
  `opts.config` действует и на ключ/`baseUrl` ИИ, а не только на политику. `runSchedule`
  передаёт `config` в шаги пайплайна.
- `SearchContext.cfg` типизирован `AppConfig`, `ExportSearchFileStage` читает
  `ctx.cfg.search?.text` (конфиг может не содержать `search`).
- Проверка: `Get-ChildItem src\application -Recurse -Filter *.ts | Select-String -Pattern 'CONFIG_PATH|config/config'`
  → пусто; `npx tsc --noEmit` → exit 0; смоук `FileConfigProvider` (явный путь, `CONFIG_PATH`,
  мемоизация, отсутствие мутации env) и проброс `opts.config` в `DigestScenario`,
  `SearchScenario`, `CoverScenario`, `ActualizeScenario`, `runSchedule` → exit 0.

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src\application -Recurse -Filter *.ts | Select-String -Pattern 'CONFIG_PATH|config/config'
npx tsx bin/auto-hh ui   # пункт «Конфигурация» читает тот же файл
```

## Риски

- `loadConfig()` возвращает `any`-совместимый объект; при вводе `AppConfig` нужно не «затянуть»
  строгие типы в домен — конфиг остаётся DTO, правила (`DigestPolicy.from`, `DigestFilter.from`)
  продолжают работать по своим типам из `domain/digest/types.ts`.
- Мемоизация: `RESUME_PATH`/`EXCLUDED_COMPANIES` читаются из env в момент загрузки — если кто-то меняет
  env после первого чтения, поведение изменится. Сейчас таких мест нет (проверено по коду).
