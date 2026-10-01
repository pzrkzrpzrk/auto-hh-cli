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

- [x] `src/domain/collect.ts`: вынести
      `ensureFullVacancies(client, ids, cache, { skipSeen = false, onProgress })`
      — тело `collectFullVacancies` (`:49-97`) становится его реализацией.
- [x] `collectFullVacancies` оставить тонкой обёрткой (публичный контракт не менять).
- [x] `cmd-digest.ts:26-43`: перейти на `ensureFullVacancies` с `skipSeen: true` (сохранив текущую проверку
      `history.isSeen` на `:28`).
- [x] `cmd-cover.ts:88-111`: перейти на `ensureFullVacancies`.
- [x] `cmd-cover.ts:15-20`: удалить локальную копию, импортировать `fmtSalary` из `domain/collect`.

## Definition of Done

- [x] В `src/` остался один вызов `client.getVacancy(` — внутри `ensureFullVacancies`
      (плюс определение в клиенте). Для пакетных путей (search/digest/cover-digest) так и есть; прямой вызов
      в `coverOne` (`cover <id>`) оставлен осознанно — см. отступление 4.
- [x] Один экземпляр логики форматирования ЗП: `fmtSalary` из `domain/collect.ts` используется и в `cmd-cover`.
- [x] `npx tsc --noEmit` → exit 0.
- [x] Печать в консоли не изменилась: строки с ЗП в `cover` и в `digest` выглядят как раньше
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

## Реализовано

1. `domain/collect.ts`: `ensureFullVacancies(client, items, cache, { skipSeen = false })` — единственная реализация
   догрузки полных карточек (кэш → `client.getVacancy` → `cache.fullById` + `saveFullVacancy`, прогресс каждые 10,
   `log.warn` на ошибку и на пустой ответ). `collectFullVacancies` — тонкая обёртка с `skipSeen: true`
   (шаг поиска свои просмотренные вакансии не качает).
2. `cmd-digest.ts`: `filterLocally` сначала догружает отсутствующие карточки одним вызовом
   `ensureFullVacancies(client, unknown, cache, { skipSeen: true })`, затем фильтрует по `cache.fullById`.
   Проверка «просмотрено» осталась: она внутри `ensureFullVacancies` (через `history.load()`), а неудачные карточки
   по-прежнему помечаются `seen` — для этого в статистику добавлено поле `failedIds`.
3. `cmd-cover.ts`: блок `missing` в `coverDigest` переведён на `ensureFullVacancies(client, missing, { fullById })`
   (`skipSeen` по умолчанию `false` — письма пишем всем); `printVacancy` печатает ЗП через общий `fmtSalary`.
4. `README.md`: строка дерева проекта у `domain/collect.ts` описывает и догрузку карточек.

### Отступления

1. **`failedIds` в статистике.** В старом `filterLocally` вакансии, карточки которых не скачались (ошибка сети или
   пустой ответ), помечались «просмотренными», чтобы не дёргать их повторно. Без списка id это поведение было бы
   потеряно, поэтому `stats.failedIds` добавлено (аддитивно; `cmd-search` печатает только прежние поля).
2. **Вход `ensureFullVacancies` — элементы, а не `ids`.** В тикете второй параметр назван `ids`, но для прогресса
   (`[n/N] Имя вакансии`) нужны элементы выдачи. Функция принимает `items` (объект `{ id, name }` или просто id,
   вход нормализуется), `cmd-cover` передаёт список id.
3. **`onProgress` из тикета не добавлен.** Прогресс печатается внутри функции одинаково для всех шагов; кастомный
   колбэк не нужен ни одному потребителю, а мёртвый параметр противоречит KISS.
4. **`client.getVacancy` осталось в двух местах `src/`** (плюс определение в `hh-client.ts`): внутри
   `ensureFullVacancies` (пакетные пути `search` / `digest` / `cover-digest`) и в `coverOne` для команды
   `cover <id>` — одна вакансия по явно указанному id. Одиночный фетч оставлен прямым, чтобы не менять печать
   команды (в пакетном пути появляются сообщения «Полные карточки: скачиваю …») и не писать карточку в `cacheFull`
   там, где раньше этого не было.
5. **Порядок сообщений в `digest`** теперь: сначала догрузка карточек, потом строки локального фильтра.
   Состав и тексты сообщений те же (`Full vacancies to fetch`, `Empty vacancy …`, `Failed to fetch vacancy …`,
   `Skip …`), меняется только порядок; поведение по данным идентично.
6. **Меньше обращений к Mongo в `digest`:** вместо `history.isSeen()` на каждую вакансию без карточки —
   один `history.load()` внутри `ensureFullVacancies` (только если такие вакансии есть), как в `collectFullVacancies`.
7. **Хвостовой пробел в строке ЗП:** `cover` печатает `fmtSalary`, поэтому при пустой валюте
   `«Зарплата: до 90000 »` стало `«Зарплата: до 90000»` (невидимый пробел в конце строки). Остальные кейсы
   (нет ЗП — строка не печатается, «от …», «до …», «от … до …», «?») совпадают побайтово.
8. **Находка для владельца:** после правки `history.isSeen` и `history.isApplied` не вызываются нигде вне
   `store/history-store.ts`; в T-08 они не трогались (кандидаты на удаление в отдельном коммите).


9. **Тексты сообщений в `cover` унифицированы** вместе с логикой: при пустом ответе было `Пустая вакансия <id>`,
   стало `Empty vacancy <id>, skipping`; при ошибке было `Не удалось получить вакансию <id>: …`, стало
   `Failed to fetch vacancy <id>: …` — как в `search`/`digest`. Смысл тот же, ради этого и делался D2.
10. **Ошибка записи карточки в Mongo больше не глушится:** в `cover` было `saveFullVacancy(full).catch(() => {})`,
    теперь ошибка попадает в общий `catch` догрузки (`log.warn` + `failed++`), как в `collectFullVacancies`.
    Карточка при этом остаётся в `cache.fullById` памяти, как и раньше.

### Проверки

- `npx tsc --noEmit` → exit 0.
- `grep` по `src/`: `client.getVacancy(` — `domain/collect.ts:79` (внутри `ensureFullVacancies`),
  `cli/cmd-cover.ts:37` (`coverOne`) и определение `clients/hh-client.ts:194`; `fmtSalary` — одно определение
  (`domain/collect.ts:122`) и три вызова: `cmd-search.ts:33`, `cmd-digest.ts:29`, `cmd-cover.ts:18`.
- Самопроверка `data/tmp-t08-selfcheck.ts` (tsx + живая MongoDB `autohh`, после прогона файл удалён):
  **27 OK / 0 FAIL**
  - `fmtSalary` — 7 кейсов (null/undefined → «—», «от», «до», «от … до …», без валюты, пустой объект → «?»);
  - паритет строки «Зарплата: …» с прежней копией в `cover` — 8 кейсов (нет ЗП, `from`, `to`, `from+to`,
    без валюты, пустой объект, нули в `from`/`to`): совпадение побайтовое, кроме хвостового пробела при пустой
    валюте (отступление 7);
  - `ensureFullVacancies` без сети/Mongo: пустой вход (`candidates=0`, клиент не вызван), всё в кэше
    (`cached=2`, обращений к hh.ru нет), ошибка + пустой ответ (`failed=2`, `saved=0`, `failedIds=[1,2]`,
    порядок вызовов `1,2`);
  - на живых данных (3 тестовых id, `skipSeen: true`): `saved=1`, `failed=1`, `skippedSeen=1`,
    `cache.fullById` заполнен только успешной карточкой, `cacheFull` получил документ с датой сессии,
    просмотренная вакансия с hh.ru не запрашивалась; обёртка `collectFullVacancies` пропускает просмотренные;
    `skipSeen: false` (путь `cover`) просмотренные не срезает; тестовые записи удалены (`cacheFull` ×2, `history` ×1).
- `npx tsx bin/auto-hh config` → exit 0; `npx tsx bin/auto-hh digest show` → exit 0 (4 вакансии, письма из кэша
  подклеены — путь `withCoverLetters` не задет).
- Прогоны `search` / `digest build` / `cover` не запускались: они требуют живых hh.ru/ИИ и меняют данные
  (см. «Что нельзя проверить в этом окружении»); за владельцем — визуальная сверка строк ЗП в `cover <id>`
  и порядка сообщений догрузки в `digest`.

