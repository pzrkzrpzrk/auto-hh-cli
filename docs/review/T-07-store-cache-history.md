# T-07 — `store/`: письма, поиск по id, история

- **Приоритет:** **P0** — REVIEW.md § I **D1**, **D11** + § II **K5**
- **Этап:** 2
- **Зависимости:** нет (делать после T-01; T-09 и T-14/T-12 зависят от этого тикета)
- **Объём:** 2 файла `store/` + 3 вызывающих

## Проблема

1. **D1 — «подклеить письма из кэша» трижды:**
   - `src/cli/cmd-apply.ts:245-249`
   - `src/cli/cmd-cover.ts:74-79` (вариант с `opts.force`)
   - `src/cli/cmd-digest.ts:267-268`

   Все три: `getLettersByVacancyIds(entries.map(e => e.id))` → merge
   `letters[String(e.id)] || e.coverLetter || ''`.

2. **D11 — поиск по id скопирован:** `src/store/cache-store.ts:91-98` (`getFullByVacancyIds`) и
   `:126-133` (`getLettersByVacancyIds`) — один алгоритм: dedupe → `$in` → `map`.

3. **K5 — лишние обращения к MongoDB:**
   - `src/cli/cmd-apply.ts:278` — `await history.load()` **внутри цикла** по вакансиям: полная выгрузка
     коллекции на каждую вакансию. При этом готовый `isApplied` (`src/store/history-store.ts:52-56`)
     **не используется нигде**.
   - `src/store/history-store.ts:39-50` — `markSeen` делает `findOne` + `updateOne`; достаточно одного
     `updateOne` с фильтром `{ vacancyId, status: { $ne: 'applied' } }`.
   - `src/cli/cmd-digest.ts:33,38,47` — `markSeen` по одному документу на вакансию в цикле до 1000 итераций.

## Что сделать

- [x] `store/cache-store.ts`: добавить `withCoverLetters(entries, { force = false })` — реализация
      по образцу `cmd-cover.ts:74-79` (он наиболее полный), с единым поведением `force`.
- [x] `store/cache-store.ts`: заменить `getFullByVacancyIds`/`getLettersByVacancyIds` на приватный
      `findByIds(collection, ids, valueField)`; публичные обёртки оставить как тонкие (`getFullByVacancyIds`,
      `getLettersByVacancyIds`), чтобы не ломать сигнатуры.
- [x] `cmd-apply.ts:245-249`, `cmd-cover.ts:74-79`, `cmd-digest.ts:267-268`: перейти на `withCoverLetters`.
- [x] `history-store.ts:39-50`: `markSeen` — один `updateOne` (upsert) без предварительного `findOne`.
- [x] `history-store.ts`: экспортировать `isApplied` (или добавить в дефолтный экспорт, если он там отсутствует)
      — `isApplied` уже был в дефолтном экспорте, дополнительно туда добавлен `markSeenMany`.
- [x] `cmd-apply.ts:278`: заменить `(await history.load())...` на `await history.isApplied(id)` —
      один индексный запрос вместо выгрузки всей коллекции на каждой итерации.
- [x] `cmd-digest.ts:33,38,47`: собрать id и вызвать `markSeen` одним `bulkWrite`/`updateMany`.

## Definition of Done

- [x] `withCoverLetters` — единственное место логики merge писем (grep по `getLettersByVacancyIds` даёт только
      определение и вызов внутри `cache-store.ts`).
- [x] `history.load()` в `cmd-apply.ts` не вызывается внутри цикла.
- [x] `npx tsc --noEmit` → exit 0.
- [x] Поведение по данным идентично: после `cover` письма видны в `digest show`; статусы откликов в
      `history` те же, что и до правки (проверить на Mongo: `db.history.find({status:'applied'})`).

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src -Recurse -Include *.ts | Select-String -Pattern 'getLettersByVacancyIds|history\.load\(\)|isApplied'
```

## Риски

- `markSeen` без предварительного `findOne` должен сохранить идемпотентность: если документ уже
  `applied`, `updateOne` не должен затирать статус — именно для этого фильтр `status: { $ne: 'applied' }`.
- `bulkWrite` в `cmd-digest` меняет момент записи: если процесс упадёт посреди шага, отметки «увиденного»
  потеряются частично. Это допустимо (идемпотентный шаг), но зафиксировать в комментарии.
- `withCoverLetters` с `force` используется `cover`; убедиться, что для `cmd-apply` и `digest`
  `force = false` (поведение «не перезаписывать уже сохранённое письмо») сохранено.

## Реализовано (с двумя отступлениями от плана — обоснованы ниже)

### Что сделано

1. `cache-store.ts`: приватный `findByIds(collection, ids, valueField)` (dedupe → `$in` → карта),
   `getFullByVacancyIds`/`getLettersByVacancyIds` — тонкие обёртки над ним; добавлен
   `withCoverLetters(entries, { force })` — единственное место merge писем. `force: true` даёт `coverLetter: ''`
   (перегенерировать всё), `force: false` — `кэш || письмо из записи`, как было в трёх копиях.
2. Вызывающие переведены на `withCoverLetters`: `cmd-apply.ts` (было `getLettersByVacancyIds` + merge),
   `cmd-cover.ts:74-79` (с `force`), `cmd-digest.ts` (`show`).
3. `history-store.ts`: `markSeen` — один атомарный `updateOne` без `findOne`; добавлен `markSeenMany(ids)` —
   один `bulkWrite`; `cmd-digest.ts` собирает id в массив и отмечает их в конце `filterLocally`.
4. `history.load()` вынесен из цикла `cmd-apply.ts` (один запрос на прогон), локальная копия обновляется
   после успешного `markApplied`, чтобы повторный id в одном прогоне не откликался дважды.

### Отступление 1: `markSeen` сделан через pipeline, а не `status: { $ne: 'applied' }` + upsert

Проверено на живой MongoDB 7 (коллекция `autohh`, индексы из `migrations/20260514-initial-indexes.js`):
у `history` есть **уникальный** индекс `{ vacancyId: 1 }`, поэтому upsert по фильтру, который не совпадает
с существующим документом, падает:

```
db.__probe.insertOne({vacancyId:'applied-1', status:'applied'})
db.__probe.updateOne({vacancyId:'applied-1', status:{$ne:'applied'}}, {$set:{status:'seen'}}, {upsert:true})
→ ERROR code=11000
```

Рабочий вариант (проверен там же) — условный статус прямо в update-pipeline:

```js
updateOne({ vacancyId }, [{ $set: {
  status: { $cond: [{ $eq: ['$status', 'applied'] }, 'applied', 'seen'] },
  at:     { $cond: [{ $eq: ['$status', 'applied'] }, '$at', now] },
} }], { upsert: true })
```

Результат на пробнике: `applied` не изменён (`modifiedCount: 0`, статус и `at` сохранены), `seen` обновлён,
новый документ вставлен, повторный вызов идемпотентен. То же для `markSeenMany` одним `bulkWrite`
(`ordered: false`).

### Отступление 2: вместо `history.isApplied(id)` — вынесенный `history.load()`

`isApplied()` отвечает на вопрос «есть ли `status: 'applied'`», но **не отличает** digest-only отметку от
реального отклика, а цикл в `cmd-apply.ts` проверяет именно `!rec.digestOnly`. Поэтому вместо N индексных
запросов сделан один `load()` до цикла (K5 закрыт: `load()` больше не вызывается внутри цикла).

Побочно исправлен **баг, найденный на живых данных**: `load()` возвращал `applied[id] = { at }` без `meta`,
поэтому `rec.digestOnly` всегда было `undefined` и `apply` считал «уже откликнулся» **любую** вакансию
дайджеста. В базе это не теория: `db.history.countDocuments({'meta.digestOnly': true})` → **184 из 184**
записей `applied`. Теперь `load()` отдаёт `{ ...meta, at }`, то есть `digestOnly` виден, и `apply`
корректно пропускает только реальные отклики. Тип `HistoryDoc` дополнен полем `meta?`.

### Проверки

- `npx tsc --noEmit` → exit 0.
- Живой прогон store-слоя на `autohh` (пробные id удалены после теста, `history` снова 777 записей):
  `markSeen` новый → создан; `markApplied(digestOnly)` + `markSeen` → статус и `meta` не затёрты;
  `markSeenMany` → работает; `load()` → `{"title":"Senior frontend-разработчик","employer":"Бизнес Технологии",
  "url":"…","score":8,"digestOnly":true,"at":"…"}`; `withCoverLetters` → подклеило письмо из
  `cacheCoverLetters` и сохранило письмо самой записи; `force: true` → пустые письма; обёртки на пустом
  входе → `{}`.
- `npx tsx bin/auto-hh cover --limit 2` → «письма уже есть: 2, генерируем: 0», письма напечатаны,
  `db.cacheCoverLetters.countDocuments()` до и после — **154 → 154** (ни одной лишней записи).
- `grep getLettersByVacancyIds` → только определение и вызов внутри `cache-store.ts`; `history.load()`
  в `cmd-apply.ts` — вне цикла.
