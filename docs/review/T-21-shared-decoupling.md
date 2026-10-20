# T-21 — `shared` без инфраструктуры и домен без `process.env`

- **Приоритет:** **P1** — транзитивная утечка инфраструктуры в домен
- **Этап:** 8
- **Зависимости:** T-17, T-18 (после них видно всех потребителей логгера)
- **Объём:** 3 файла `shared` + 2 файла домена + точки передачи параметров
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

По документации (`docs/architecture.md:34`) `shared` «не зависит ни от чего из слоёв». Фактически:

| Файл | Строка | Импорт |
|---|---|---|
| `shared/logger.ts` | `:2-3` | `fs` + `infrastructure/config/paths` (`LOG_FILE`, `ensureDir`) |
| `shared/concurrency.ts` | `:6` | `intFromEnv` из `infrastructure/config/env` |
| `shared/retry.ts` | `:1,3` | **`openai`** + `positiveIntFromEnv` |

Из-за этого домен **транзитивно** зависит от файловой системы и env:

- `domain/grade-resume.ts:2`, `domain/judge/judge.ts:1`, `domain/cover-letter/cover-letter.ts:1,7`,
  `domain/digest/DigestEntryFactory.ts:4`, `domain/digest/DigestMatcher.ts:4` — через `logger`
  и `concurrency`;
- `domain/cover-letter/cover-letter.ts:22,107` и `domain/cover-letter/system-text.ts:6` —
  прямой `process.env` (`APPLICANT_PROFILE`, `COVER_SIGNATURE`);
- `shared/retry.ts:5-7` вычисляет конфиг **на этапе импорта** — настройки «запекаются» при загрузке модуля.

Утверждение «домен не импортирует инфраструктуру» верно только для прямых импортов.

## Что сделать

- [x] `domain/ports.ts`: узкий порт `Logger { info; warn; error; debug }` (или `LogSink`).
- [x] `infrastructure/logging/logger.ts`: текущая реализация (`fs.appendFileSync` + `LOG_FILE`).
      `shared/logger.ts` удалить; импорты в слоях перевести на порт (в `application` — через deps,
      в `domain` — параметром или через событие).
- [x] `shared/concurrency.ts`, `shared/retry.ts`: убрать чтение env — числа приходят параметрами
      (`concurrency`, `attempts`, `baseDelayMs`); значения по умолчанию остаются в адаптере.
- [x] `shared/retry.ts:25`: убрать `import OpenAI` — проверять `err?.name === 'APIConnectionError'`
      или `err?.status`, как уже делается ниже.
- [x] Домен: `coverSignature()` и `APPLICANT_PROFILE` → поля `CoverOptions { signature, profile }`,
      заполняет сценарий из `CoverConfig`.
- [x] Логи домена (`DigestMatcher`, `DigestEntryFactory`) — вернуть данные, логи оставить стадии
      (см. T-24/идею «домен без побочек»).

## Definition of Done

- [x] `Select-String -Path src\shared -Pattern '../infrastructure|from \"openai\"'` → пусто.
- [x] `Select-String -Path src\domain -Pattern 'process\.env|shared/logger|shared/concurrency'` → пусто.
- [x] `npx tsc --noEmit` → exit 0.
- [x] Логи в `data/app.log` пишутся как раньше (уровни, отметка времени Europe/Moscow).

## Проверка

```powershell
npx tsc --noEmit
Select-String -Path src\shared,src\domain -Pattern 'infrastructure|process\.env|from "openai"'
Get-Content data\app.log -Tail 5
```

## Риски

- Логгер — самое частое место правок: 26 файлов импортируют `shared/logger`. Чтобы не раздувать diff,
  допустим промежуточный шаг: `shared/logging.ts` с типом + `infrastructure/logging` с реализацией,
  а `shared/logger.ts` остаётся фасадом **до** T-22. Полный уход от глобального логгера — отдельный коммит.
- Подпись письма (`COVER_SIGNATURE`) — часть формата `.md` и писем; при передаче параметром
  значение по умолчанию должно остаться тем же плейсхолдером.

## Выполнено (2026-10-19)

- `shared/logger.ts` — чистый фасад `LogSink`: без `fs`, env и `config/paths`.
  Реализация файла/`DEBUG` — в `infrastructure/logging/logger.ts`; composition root
  регистрирует sink при старте.
- `shared/batches.ts` — `chunk`/`runBatches` без env и глобального логгера: прогресс/ошибки
  идут через необязательный `logger`, параллелизм приходит параметром. `shared/concurrency.ts`
  удалён; env-настройки читает composition root.
- `shared/retry.ts` — без `openai` и env: transient-ошибки по `err.name`/`err.status`,
  `attempts`/`baseDelayMs`/`maxDelayMs` передаёт адаптер `infrastructure/ai/client.ts`.
- `domain/ports.ts` — `Logger` (файл `domain/logging.ts`); домен получает логгер параметром:
  `gradeResume`, `judge*` (`JudgeOpts.logger`), `DigestMatcher`, `DigestEntryFactory`,
  `buildCoverLetter`/`buildCoverLettersBatch`.
- Env-настройки писем (`APPLICANT_PROFILE`, `COVER_SIGNATURE`, `AI_CONCURRENCY`) читает
  `composition.coverConfig`; `JUDGE_BATCH_SIZE`/`AI_CONCURRENCY` для дайджеста —
  в `DigestDeps.settings`.
- `application → infrastructure` сократился до одного импорта (`grade` — загрузка резюме,
  закрывается T-22); `shared` и `domain` больше не тянут инфраструктуру.
- Проверка: `Select-String -Path src\shared -Pattern '../infrastructure|from "openai"'` → пусто;
  `Select-String -Path src\domain -Pattern 'process.env|shared/logger|shared/concurrency'` → пусто;
  `npx tsc --noEmit` → 0; смоук логов и `retryOnTransient` → ok.
