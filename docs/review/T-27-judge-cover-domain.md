# T-27 — домен `judge`/`cover-letter`: Value Objects, Domain Services и транспорт вне домена

- **Приоритет:** **P2** — SRP внутри слоя и чистота домена, без изменения поведения
- **Этап:** 10
- **Зависимости:** T-23 (`strict` + `arch`), T-24 (домен без побочек)
- **Объём:** 4 файла домена заменены, 2 Application Service, 3 потребителя, 4 спека
- **Пути:** актуальны на 2026-10-28

## Проблема

1. **Домен судьи делает I/O.** `domain/judge/judge.ts` — свободные функции `judgeVacancy`/`judgeVacanciesBatch`
   с 4–6 параметрами: `AiProvider`, `try/catch`, `parseJSON`, логгер. Правила вердикта (`normalizeVerdict`),
   терпимость к форме ответа (`verdictList`) и форматирование промпта — приватные функции одного файла,
   поэтому инвариант нельзя проверить отдельно от сети.
2. **Домен писем смешивает три ответственности.** `domain/cover-letter/cover-letter.ts` содержит шаблон,
   построение промптов, пачки (`chunk`/`runBatches`), конкурентность, `onBatch` и логи.
   `CoverLetterOptions` дублирует поля `CoverConfig`, а `buildCoverLettersBatch` принимает 7 параметров.
3. **Модели не на месте.** `Verdict` и `JudgeOpts` объявлены в `domain/models.ts`, хотя относятся только к судье.
4. **Дефолты писем размазаны.** `DEFAULT_PROFILE`/`DEFAULT_CONCURRENCY` — в домене,
   бюджет и подпись — в `infrastructure/config/cover-config.ts`.

## Что сделать

- [x] `domain/judge/Verdict.ts` — Value Object + фабрики `fromModel`/`listFromModel`, `toJudgement()`.
- [x] `domain/judge/JudgePrompt.ts` — Domain Service: system, batch-система, блок вакансии.
- [x] `domain/cover-letter/{CoverSignature,CoverTemplate,CoverLetterPrompt}.ts` — подпись, шаблон, промпты.
- [x] `domain/cover-letter/config.ts` → `CoverSettings` (VO); `CoverConfig` остаётся type-alias'ом.
- [x] `application/judge/JudgeService.ts` — `chat`, ошибки → `null`, логи с прежними текстами.
- [x] `application/cover-letter/CoverLetterService.ts` — одна вакансия и пачки, `onBatch`, fallback на шаблон.
- [x] `JudgeStrategy`, `SingleVacancyMode`, `GenerateLettersStage` переведены на сервисы.
- [x] `Verdict` и `JudgeOpts` убраны из `domain/models.ts`.

## Definition of Done

- [x] `npx tsc --noEmit` → exit 0; `npm run arch` → 0 нарушений; `npm run test:types` → exit 0.
- [x] `Select-String -Path src/domain/judge/*.ts,src/domain/cover-letter/*.ts -Pattern 'AiProvider|chat\(|logger'` → пусто.
- [x] 29 адресных тестов: `judge-verdict`, `judge-service`, `cover-template`, `cover-letter-service`.
- [x] `node bin/auto-hh --help` → exit 0.
- [x] Промпты, метки запросов, тексты логов, порядок пачек и fallback сохранены.

## Проверка

```powershell
npx tsc --noEmit
npm run arch
npm run test:types
npx vitest run tests/judge-verdict.spec.ts tests/judge-service.spec.ts tests/cover-template.spec.ts tests/cover-letter-service.spec.ts --reporter=dot
Select-String -Path src/domain/judge/*.ts,src/domain/cover-letter/*.ts -Pattern 'AiProvider|chat\(|logger'
node bin/auto-hh --help
```

## Итог (2026-10-28)

- Домен судьи: `Verdict` (инвариант, clamp 1..10, обе формы ответа) + `JudgePrompt`; транспорт — `JudgeService`,
  `AiJudgeStrategy` стал адаптером.
- Домен писем: `CoverSignature`, `CoverTemplate`, `CoverSettings`, `CoverLetterPrompt`; генерация — `CoverLetterService`.
- Настройки писем собираются `CoverSettings.from(...)`; env и config.json читает только
  `infrastructure/config/cover-config.ts`.
- Поведение не менялось: тексты промптов и логов, метки `судья …` / `письма батч N` / `письмо`,
  `json: true` у батчей, fallback «ИИ → шаблон», частичное сохранение после каждой пачки.

## Риски

- `Verdict` теперь класс: `JudgementSet.merge` принимает структурно совместимую `Map`, в `cache_judgements`
  по-прежнему пишутся только `score/fit/reason/comment`. Проверяется `tsc` и спеками сервиса.
- `CoverSettings.signature` — VO, а не строка; `CoverTemplate`/`CoverLetterPrompt` принимают и строку,
  и `CoverSignature`, поэтому внешние вызовы не ломаются.
- Живые прогоны `digest`/`cover` не запускались: нужны ключ ИИ и hh.ru. Замена — фейковый `AiProvider`
  и проверка промптов в спеках.
