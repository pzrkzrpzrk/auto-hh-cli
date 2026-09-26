# T-08 — `domain/collect`: догрузка карточек и форматирование ЗП

- **Приоритет:** P1 — REVIEW.md § I **D2** (+ **D9**, P2)
- **Этап:** 3
- **Зависимости:** T-06 (единый пул воркеров), T-04 (`intFromEnv`)
- **Объём:** 3 копии логики → 1 функция, + 1 импорт

## Проблема

### D2 — «догрузить отсутствующие полные карточки с hh.ru» трижды

- `src/cli/cmd-digest.ts:26-43` (внутри `filterLocally` :22-55)
- `src/cli/cmd-cover.ts:88-111` (`coverDigest`)
- `src/domain/collect.ts:49-97` (`collectFullVacancies` — наиболее полный вариант, со статистикой)

Общая суть одинаковая: взять найденное из кэша (`getFullByVacancyIds` / `cache.fullById`) → для отсутствующих
вызвать `client.getVacancy(id)` → записать в `cache.fullById` и `saveFullVacancy` → `log.warn` при ошибке.
Различия в копиях: статистика и проверка `history.isSeen` (`cmd-digest.ts:28`); отсюда же — расхождения
в поведении при ошибках сети между шагами.

### D9 — форматирование зарплаты переписано

`src/cli/cmd-cover.ts:15-20` дублирует `fmtSalary` из `src/domain/collect.ts:111-117`.

## Что сделать

- [ ] `src/domain/collect.ts`: вынести
      `ensureFullVacancies(client, ids, cache, { skipSeen = false, onProgress })`
      — тело `collectFullVacancies` (`:49-97`) становится его реализацией.
- [ ] `collectFullVacancies` оставить тонкой обёрткой (публичный контракт не менять).
- [ ] `cmd-digest.ts:26-43`: перейти на `ensureFullVacancies` с `skipSeen: true` (сохранив текущую проверку
      `history.isSeen` на `:28`).
- [ ] `cmd-cover.ts:88-111`: перейти на `ensureFullVacancies`.
- [ ] `cmd-cover.ts:15-20`: удалить локальную копию, импортировать `fmtSalary` из `domain/collect`.

## Definition of Done

- [ ] В `src/` остался один вызов `client.getVacancy(` — внутри `ensureFullVacancies`
      (плюс определение в клиенте).
- [ ] Один экземпляр логики форматирования ЗП: `fmtSalary` из `domain/collect.ts` используется и в `cmd-cover`.
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] Печать в консоли не изменилась: строки с ЗП в `cover` и в `digest` выглядят как раньше
      (важные кейсы: «не указана», диапазон, фиксированная сумма).

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src -Recurse -Include *.ts | Select-String -Pattern 'getVacancy\(|fmtSalary'
```

## Риски

- Копии различаются обработкой «вакансия удалена» (hh отдаёт 404/архив) — сохранить текущее поведение
  `log.warn` + пропуск, не превращая в фатальную ошибку.
- `skipSeen: true` меняет смысл параметра для `cmd-cover` — там проверки `isSeen` не было, поэтому по
  умолчанию `false`, чтобы не «срезать» вакансии в шаге писем.
- Порядок записи в кэш (`cache.fullById` + `saveFullVacancy`) должен остаться прежним, иначе TTL/дедупликация
  полных карточек изменятся.
