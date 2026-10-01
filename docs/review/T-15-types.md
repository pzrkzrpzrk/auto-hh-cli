# T-15 — Типы: `Vacancy.description` и `any` на границах

- **Приоритет:** P2 — REVIEW.md § III
- **Этап:** 5
- **Зависимости:** T-02 (после удаления мёртвого кода), T-12 (после распила `cmd-apply`)
- **Объём:** 1 тип + несколько сигнатур

## Проблема

1. **`Vacancy.description` объявлен обязательным, но не заполняется.**
   `src/types.ts:4` — `description: string`, при этом `mapSearchItem` (`src/clients/hh-client.ts:41-53`)
   его вообще не возвращает. Компилятор это не ловит только из-за `// @ts-nocheck`
   в первой строке `src/clients/hh-client.ts` — единственного файла в проекте без проверки типов (202 строки).
   Реальная форма объекта: `description?: string`.
2. **`any` на границах модулей:** `judge.ts`, `cover-letter.ts`, `collect.ts`, `cmd-digest.ts`, `cmd-apply.ts`
   активно используют `any` / `Record<string, any>`, хотя типы `DigestEntry` (`src/types.ts:44-55`) и
   `Verdict` (`src/types.ts:15-22`) **уже существуют** и не применяются на входных/выходных границах.
3. **`log.error` пишет в stdout** (`src/logger.ts`): используется `console.log`, а не `console.error`,
   из-за чего ошибки не отделяются от обычного вывода (важно при перенаправлении в файл).

## Что сделать

- [ ] `src/types.ts:4`: `description?: string`; проверить всех потребителей (несколько мест уже делают
      `vacancy.description || ''` — после правки они остаются корректными).
- [ ] `src/clients/hh-client.ts`: снять `@ts-nocheck` (или сузить его до конкретных строк), исправить
      ошибки типов, которые проявятся; начать с типизации `mapSearchItem` и возвращаемых объектов.
- [ ] `judge.ts` / `cover-letter.ts` / `collect.ts`: заменить `Record<string, any>` на `Verdict` /
      `DigestEntry` там, где это уже возможно переиспользовать.
- [ ] `src/logger.ts`: `log.error` → `console.error` (сохранив префиксы и цвета, если они есть).
- [ ] Не расширять объём: цель — **включить проверку типов** там, где она была отключена, и убрать
      взаимозаменяемые `any` на границах, а не «типизировать всё».

## Definition of Done

- [ ] `Get-ChildItem src -Recurse -Include *.ts | Select-String -Pattern '@ts-nocheck'` не находит совпадений.
- [ ] `npx tsc --noEmit` → exit 0 **без** `@ts-nocheck`.
- [ ] `log.error` пишет в `stderr`: проверить `node bin/auto-hh ui 2> errors.txt` — ошибки попадают в файл.
- [ ] Поведение не изменилось: меню и безопасные шаги работают как раньше.

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src -Recurse -Include *.ts | Select-String -Pattern '@ts-nocheck'
node bin/auto-hh ui 2> errors.txt
```

## Риски

Снятие `@ts-nocheck` почти наверняка откроет десятки ошибок типов в `hh-client.ts` (там `any`-подписи
и работа с необработанными ответами hh.ru). Делать это отдельным коммитом и, если объём окажется большим,
заменить `@ts-nocheck` на `@ts-expect-error`-партиции поэтапно — важно, чтобы `tsc` начал видеть файл,
пусть и с несколькими точечными исключениями вместо полного отключения.

После T-12 файл `cmd-apply.ts` уже разбит — типизировать его куски следует в этом тикете, а не в T-12,
чтобы не смешивать перемещение кода и правку типов.
