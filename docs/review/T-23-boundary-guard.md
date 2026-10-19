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

- [ ] Зависимость `dependency-cruiser` (dev) + `.dependency-cruiser.js` с правилами:

      | from | to (forbidden) |
      |---|---|
      | `^src/domain` | `^src/(infrastructure|application|presentation)` |
      | `^src/shared` | `^src/(infrastructure|application|presentation|domain)` |
      | `^src/application` | `^src/(infrastructure|presentation)` |
      | `^src/infrastructure` | `^src/(application|presentation)` |
      | `^src/presentation` | `^src/infrastructure` |

      Исключение — `src/composition.ts` (ему можно всё) и type-only импорты, если решим их разрешить.
- [ ] `npm run arch` → `depcruise src`; включить в `build`/CI.
- [ ] `tsconfig.json`: `"strict": true` (поэтапно: сначала `strictNullChecks`, затем остальное).
- [ ] Убрать `any` из портов: `savePage`, `saveFullVacancy`, `HistoryStore.load`, `JudgementCache.save`,
      `DigestFileSource.latestContents` (см. T-18/T-20 — там уже появляются типизированные методы).

## Definition of Done

- [ ] `npm run arch` → 0 нарушений (после закрытия T-17…T-22).
- [ ] `npx tsc --noEmit` → exit 0 при `strict: true`.
- [ ] Новый импорт `application → infrastructure` ломает `npm run arch` (проверить на временной строке).

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
