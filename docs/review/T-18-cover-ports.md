# T-18 — `application/cover.ts` на существующие порты

- **Приоритет:** **P0** — нарушение Dependency Rule
- **Этап:** 8 (в паре с T-17)
- **Зависимости:** нет; расширяются два уже объявленных порта (`CoverLetterCache`, `CacheStore`)
- **Объём:** 1 сценарий (`application/cover.ts`, 161 строка) + 2 порта + 2 адаптера + `composition`
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

Пять инфраструктурных импортов при том, что **порты для всего этого уже существуют**:

| Строка | Импорт | Существующий порт |
|---|---|---|
| `application/cover.ts:5` | `files/resume-loader` (`loadResume`) | `ResumeProvider` (`domain/digest/ports.ts:55`) |
| `:6` | `config/config` (`loadConfig`) | — (см. T-19; здесь закрывается локально) |
| `:7` | `config/env` (`intFromEnv`) | — (то же) |
| `:8` | `mongo/cache-store` (`saveLetter`, `withCoverLetters`, `getFullByVacancyIds`) | `CoverLetterCache` + `CacheStore` |
| `:14` | `mongo/digest-store` (`getLatestDigest`, `writeDigest`) | `DigestRepository` (`domain/digest/ports.ts:24`) |

Дополнительно:

- `coverDigest` (`:100-105`) собирает `SearchCache` вручную (`{ date: '', pages: {} }`), чтобы
  догрузить карточки — то есть сценарий знает устройство кэша;
- `loadConfig()` вызывается трижды за прогон (`:47`, `:74`, `:146`), каждый раз — `readFileSync` + `JSON.parse`;
- `CoverDeps` (`:18-24`) объявлен как «конкретные реализации подставляет команда», хотя `coverDeps`
  собирает `composition.ts` — комментарий врёт.

## Что сделать

- [x] `domain/digest/ports.ts`: `CoverLetterCache` расширить до реальных нужд шага —
      `attach(entries, opts?: { force?: boolean })` и `save(vacancyId, letter)`.
- [x] `domain/ports.ts`: `CacheStore.getFullByVacancyIds(ids)` — чтение карточек из `cacheFull`
      (реализация уже есть в `infrastructure/mongo/cache-store.ts:100`).
- [x] `infrastructure/mongo/cover-letter-cache.ts`: реализовать `attach(entries, { force })` и `save`.
- [x] `application/cover.ts`: `CoverDeps { ai, config, collect, source, resumeFiles, digests, letters }`;
      удалить 5 импортов `../infrastructure/*`; `config()` возвращает
      `CoverConfig { coverLetterTemplate, adaptResume, batchSize }`.
- [x] `composition.ts`: `coverDeps` собирается из `digestRepository`, `coverLetterCache`,
      `resumeFileProvider` и функции `coverConfig()` (читает `config.json` + `COVER_BATCH_SIZE`).
- [x] Догрузку карточек (`:100-105`) оставить через `VacancyCollector` + `deps.collect.cacheStore`.

## Definition of Done

- [x] `application/cover.ts` не содержит импортов `infrastructure/*`.
- [x] `npx tsc --noEmit` → exit 0.
- [x] Поведение не изменилось: те же исходы `CoverOutcome`, те же сообщения (`no-resume`, `empty`,
      «письма уже есть / генерируем»), письма пишутся в `cacheCoverLetters` **по мере готовности пачки**,
      `digest` обновляется тем же `save('digest', …, digest.date)`.
- [x] `opts.force` по-прежнему перегенерирует письма (проверяется через `attach(entries, { force })`).

## Проверка

```powershell
npx tsc --noEmit
Select-String -Path src\application\cover.ts -Pattern 'infrastructure|mongo|resume-loader'
npx tsx bin/auto-hh cover --limit 2   # письма уже есть → «генерируем: 0», count cacheCoverLetters не растёт
```

## Риски

- Порты расширяются, а не создаются заново: `DigestShowScenario` вызывает `attach(entries)` —
  параметр `opts` делаем необязательным, чтобы не ломать вызов.
- `getFullByVacancyIds` в порту `CacheStore` расширяет контракт для всех потребителей
  (реализация — модуль `cache-store.ts`, он же используется как адаптер в `composition.ts`).
- Реальную генерацию писем без ключа ИИ проверить нельзя — проверка идёт на ветке «письма уже есть»
  плюс статикой.

## Реализовано

1. `domain/digest/ports.ts`: `CoverLetterCache.attach(entries, opts?: { force? })` + `save(vacancyId, letter)`.
2. `domain/ports.ts`: `CacheStore.getFullByVacancyIds` (реализация — существующая функция
   `cache-store.ts`, поэтому `composition` продолжает передавать модуль как адаптер).
3. `infrastructure/mongo/cover-letter-cache.ts`: `attach` пробрасывает `force`, `save` вызывает `saveLetter`.
4. `application/cover.ts` (176 строк): `CoverConfig`, `CoverDeps` из 7 портов; `loadConfig`,
   `intFromEnv`, `collectCache.*`, `getLatestDigest`/`writeDigest`, `loadResume` заменены на
   `deps.config()`, `deps.letters.*`, `deps.digests.*`, `deps.resumeFiles.load`.
   `coverOne` больше не принимает неиспользуемый `opts`.
5. `composition.ts`: `coverConfig()` (шаблон, `adaptResume`, `COVER_BATCH_SIZE`) + `coverDeps`.

### Проверки

- `npx tsc --noEmit` → **exit 0**.
- `Select-String -Path src\application\cover.ts -Pattern 'infrastructure|mongo|resume-loader|loadConfig'`
  → пусто (совпадения только в комментариях).
- Smoke на фейковых портах (временный файл, удалён), 4 сценария:
  - полный путь: фиктивный `AiProvider` вернул письмо → `letters.save('1', …)` вызван один раз,
    `digests.save('digest', entries, '2026-10-19')` — один раз, в записи письмо «Здравствуйте…»;
  - `resumeFiles.load → null` → `{ kind: 'no-resume' }`;
  - `digests.latest → null` → `{ kind: 'empty' }`;
  - письмо уже есть в дайджесте → `{ kind: 'digest' }`, `letters.save` не вызывается
    (фейк бросал бы исключение).
- Живой прогон с реальными Mongo/ИИ не выполнялся (нет ключа и базы в этом окружении).

### ООП-редакция (2026-10-19)

Сценарий разложен на ООП-подсистему `application/cover/` по образцу `search/` и `digest/` —
поведение, `CoverOutcome` и тексты логов не менялись:

| Паттерн | Файл | Роль |
|---|---|---|
| Facade | `CoverScenario.ts` | проверки резюме/шаблона → выбор режима → результат |
| Strategy | `CoverMode.ts` + `SingleVacancyMode.ts` / `DigestCoverMode.ts` | «одна вакансия» и «весь дайджест» — разные классы вместо ветки `if` |
| Template Method | `CoverStage.ts` | каркас стадии: `enabled → execute → onError` |
| Chain of Responsibility | `CoverPipeline.ts` + `stages.ts` | `LoadDigest → Limit → AttachLetters → EnsureCards → SelectItems → GenerateLetters → PersistDigest` |
| Value Object | `CoverPlan.ts` | `CoverPlan`/`CoverProgress`: счётчики и ровно прежние строки «Вакансий…», «Сопроводительных готово…» |
| Ports & Adapters | `CoverDeps.ts` | нет импортов `infrastructure`; конфиг читается один раз, а не трижды |

`application/cover.ts` остался совместимой обёрткой `runCover(vacancyId, opts, deps, onVacancy)`;
`composition.ts` и `cmd-cover.ts` не менялись, `CoverConfig`/`CoverDeps` реэкспортируются.

Проверки ООП-редакции:

- `npx tsc --noEmit` → exit 0;
- `Select-String -Path src\application\cover.ts,src\application\cover\*.ts -Pattern 'infrastructure|mongo|resume-loader|loadConfig'`
  → только комментарии и текст лога «нужна MongoDB»;
- smoke на фейковых портах (временный `data/tmp-cover-oop-smoke.ts`, удалён) — 9 сценариев:
  одна вакансия, `not-found`, кэш + генерация пачкой с обновлением дайджеста, все письма уже
  есть, `force`, `limit` (команде — срез, дайджест — целиком), пустой дайджест и ошибка Mongo,
  нет описаний вакансий, нет резюме; плюс формат `CoverPlan`/`CoverProgress`. Все assert'ы
  прошли, `npx tsx data/tmp-cover-oop-smoke.ts` → exit 0.

