# T-23 — Защита границ: `dependency-cruiser` + `strict: true`

- **Приоритет:** **P1** — без этого правила деградируют снова
- **Этап:** 9
- **Зависимости:** T-17…T-22 (сначала убрать нарушения, потом запретить их)
- **Объём:** `package.json`, `.dependency-cruiser.js`, `tsconfig.json`, npm-скрипты
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

Архитектурное правило существует только в `docs/architecture.md`. В проекте нет ни `eslint`,
ни `dependency-cruiser`, ни `tsconfig` project references, поэтому нарушения копятся незаметно:

- `application → infrastructure`: **26 импортов в 12 файлах**;
- `shared → infrastructure`: 3 файла;
- `presentation → infrastructure`: 4 файла;
- транзитивно `domain → shared → infrastructure`;
- `"strict": false` в `tsconfig.json` + ~175 токенов `any`, из них часть — прямо в портах
  (`CacheStore.savePage(state: any)`, `HistoryStore.load(): Record<string, any>`).

Единственная автоматическая проверка сейчас — `npx tsc --noEmit`.

## Что сделать

- [x] Зависимость `dependency-cruiser` (dev) + `.dependency-cruiser.js` с правилами:

      | from | to (forbidden) |
      |---|---|
      | `^src/domain` | `^src/(infrastructure|application|presentation)` |
      | `^src/shared` | `^src/(infrastructure|application|presentation|domain)` |
      | `^src/application` | `^src/(infrastructure|presentation)` |
      | `^src/infrastructure` | `^src/(application|presentation)` |
      | `^src/presentation` | `^src/infrastructure` |

      Исключение — `src/composition.ts` (ему можно всё) и type-only импорты, если решим их разрешить.
- [x] `npm run arch` → `depcruise src`; включить в `build`/CI.
- [x] `tsconfig.json`: `"strict": true` (поэтапно: сначала `strictNullChecks`, затем остальное).
- [x] Убрать `any` из портов: `savePage`, `saveFullVacancy`, `HistoryStore.load`, `JudgementCache.save`,
      `DigestFileSource.latestContents` (см. T-18/T-20 — там уже появляются типизированные методы).

## Definition of Done

- [x] `npm run arch` → 0 нарушений (после закрытия T-17…T-22).
- [x] `npx tsc --noEmit` → exit 0 при `strict: true`.
- [x] Новый импорт `application → infrastructure` ломает `npm run arch` (проверено на временной строке:
      `src/application/collect.ts → src/infrastructure/mongo/db.ts` → 1 error, после удаления — 0).

## Итог (2026-10-19)

- `dependency-cruiser@18` в devDependencies, конфиг `.dependency-cruiser.js`; `npm run arch` входит в
  `npm run build` (сборка падает на нарушении границ, не только на ошибке типов).
- `tsPreCompilationDeps: true` — type-only импорты тоже считаются зависимостями; `composition.ts`
  остаётся вне правил, потому что лежит не в каталоге слоя.
- Закрыты оставшиеся нарушения: T-22 уже убрал прямые импорты инфраструктуры (`grade` → `ResumeFiles`,
  `closeResources()`, `application/config-view.ts`, меню через `application/resume.ts`); T-23 фиксирует
  это правило в `.dependency-cruiser.js` и проверяет его на временном импорте. `ResumeProvider` перенесён
  из `domain/digest/ports.ts` в `domain/ports.ts` рядом с `ResumeFiles` (общий порт cover/digest).
- Порты типизированы: `CacheStore.savePage(state: SearchCacheSnapshot)`,
  `saveFullVacancy(vacancy: Vacancy)`, `HistoryStore.load(): HistoryState`,
  `JudgementCache.save(Record<string, Judgement>)`; `SearchCacheSnapshot` — `VacancyListItem[]`/`Vacancy`.
- `strict: true`: 121 ошибка закрыта без `@ts-ignore` и без `any` в новых сигнатурах; для `catch (err)`
  добавлен `shared/errors.ts` (`errorMessage`, `errorName`).
- Поведение не менялось: формат меню, env-переменные, коллекции Mongo и `.md`-артефакты те же;
  типы `Vacancy`/`DigestEntry` уточнены под реальные `null` из hh.ru и вердикта без судьи.

## Проверка

```powershell
npm run arch
npx tsc --noEmit
```

## Риски

- `strict: true` — большой механический diff (опциональные поля, `null`). Делать отдельным коммитом,
  без смешивания с логикой; `strictNullChecks` первым.
- Правило `application → infrastructure` может заблокировать временные исключения из T-19/T-22 —
  поэтому порядок в README: сначала тикеты, потом запрет.
