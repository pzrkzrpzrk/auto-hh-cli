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

- [ ] `domain/ports.ts`: порт `ConfigProvider { load(path?: string): AppConfig }`
      (`AppConfig` — тип, вынесенный из `config.ts`, без fs внутри).
- [ ] `infrastructure/config/config.ts`: `FileConfigProvider implements ConfigProvider`,
      мемоизация по `absPath`, явный параметр `path` вместо чтения `process.env.CONFIG_PATH`
      в глубине (env остаётся дефолтом для адаптера).
- [ ] Сценарии (`DigestScenario`, `ActualizeScenario`, `SearchScenario`, `schedule`, `cover`):
      получать `cfg`/`CoverConfig` из deps; удалить присваивания `process.env.CONFIG_PATH`.
      `opts.config` передаётся в `deps.config.load(opts.config)`.
- [ ] `composition.ts`: один `configProvider` на процесс; `coverConfig()` и `digestDeps` используют его.
- [ ] CLI: `opts.config` остаётся внешним контрактом (`--config`) — меняется только способ доставки.

## Definition of Done

- [ ] `Select-String -Path src\application -Pattern 'process\.env\.CONFIG_PATH\s*='` → пусто.
- [ ] `Select-String -Path src\application -Pattern 'config/config'` → пусто.
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] Поведение не изменилось: `opts.config` по-прежнему позволяет указать другой файл для одного прогона;
      параллельные прогоны в одном процессе больше не влияют друг на друга.

## Проверка

```powershell
npx tsc --noEmit
Select-String -Path src\application -Pattern 'CONFIG_PATH|config/config'
npx tsx bin/auto-hh ui   # пункт «Конфигурация» читает тот же файл
```

## Риски

- `loadConfig()` возвращает `any`-совместимый объект; при вводе `AppConfig` нужно не «затянуть»
  строгие типы в домен — конфиг остаётся DTO, правила (`DigestPolicy.from`, `DigestFilter.from`)
  продолжают работать по своим типам из `domain/digest/types.ts`.
- Мемоизация: `RESUME_PATH`/`EXCLUDED_COMPANIES` читаются из env в момент загрузки — если кто-то меняет
  env после первого чтения, поведение изменится. Сейчас таких мест нет (проверено по коду).
