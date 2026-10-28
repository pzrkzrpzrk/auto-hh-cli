# T-28 — `domain/grade-resume`: Domain Service, VO оценки и ИИ вне домена

- **Приоритет:** **P1** — последнее место, где домен делает I/O (R1 в [`REVIEW.md`](../../REVIEW.md))
- **Этап:** 11
- **Зависимости:** T-24, T-27 (образец: `judge`/`cover-letter`)
- **Объём:** 1 файл домена заменён, 1 Application Service, 1 потребитель, 2 спека
- **Пути:** актуальны на 2026-10-28
- **Статус:** ✅ сделано (`ab70b9d`); живой прогон `grade` не выполнялся (нужен ключ ИИ)

## Проблема

`src/domain/grade-resume.ts` (139 строк) смешивает всё, что T-27 развёл в `judge`/`cover-letter`:

1. `:5-28` — свой `safeJsonParse` (фенсы, `**`, эвристика кавычек, срез управляющих символов);
   общий `shared/text-utils.ts:5` не используется.
2. `:30-92` — системный промпт строкой в домене.
3. `:96` — `gradeResume(ai, resume, logger)`: домен зовёт `ai.chat` (`:120`), логирует
   (`:98,103,124,129,134`) и возвращает `Record<string, any>`.
4. `application/grade.ts` — тонкая обёртка, которая уже получает `AiProvider` и `ResumeFiles`
   портами, то есть весь транспорт можно поднять уровнем выше.

Следствие: инвариант «что считается оценкой и как зажимаются баллы» нельзя проверить без ключа ИИ,
парсеров JSON в проекте два, а правило «домен без побочек» (T-24) здесь обходится.

## Что сделать

- [x] `domain/grade-resume/GradePrompt.ts` — Domain Service: `systemText()`, `userText(resume)`
      (тексты переносятся **дословно**: их формулировки влияли на ответы модели). _Перенос сделан
      `git mv` и сверен сравнением строк: 2611 символов совпали байт-в-байт._
- [x] `domain/grade-resume/ResumeGrade.ts` — VO: разбор `overallScore`, `categoryScores`,
      списков, clamp в 0..100; неизвестная форма → `null`.
- [x] `application/grade/ResumeGradeService.ts` — `chat({ json: true, label: 'оценка резюме' })`,
      пустой ответ/ошибка → `null`, `logger.warn/debug` с прежними текстами
      (`gradeResume: no API client (check API key)`, `… resume not found (set RESUME_PATH)`,
      `… empty response`, `gradeResume: score=… in=… out=…`, `gradeResume failed: …`).
- [x] `application/grade.ts` собирает сервис из `GradeDeps` (`ai`, `resumeFiles`, `logger`).
- [x] `parseJSON` в `shared/text-utils.ts` — единственный парсер для всех ИИ-ответов;
      `grade-resume.ts` удалить.
- [x] Тесты: `tests/grade-prompt.spec.ts` (тексты промпта, PDF-фолбэк),
      `tests/resume-grade-service.spec.ts` (успех, пустой ответ, ошибка модели, нет ключа) и
      `tests/grade-report.spec.ts` (формат `.md` — инвариант).
- [x] Попутно R9: запись `resume-grade.md` вынесена из presentation за порт `TextFileWriter`
      (адаптер `infrastructure/files/text-file-writer.ts`).

## Definition of Done

- [x] `npx tsc --noEmit` → exit 0; `npm run arch` → 0 нарушений; `npm run test:types` → exit 0.
- [x] В домене не осталось **использований** ИИ и логов: `Select-String` по `src/domain` на
      `ai\.chat\(|safeJsonParse|logger\?\.` пуст; `AiProvider` и `Logger` встречаются только как
      объявления портов (`domain/ports.ts`, `domain/logging.ts`).
- [x] Поведение не меняется: те же тексты промпта, `json: true`, те же `log.warn/debug`,
      `null` вместо исключения, формат `resume-grade.md` и консольного отчёта прежний.

## Проверка

```powershell
npx tsc --noEmit
npm run arch
npm run test:types
npx vitest run tests/grade-prompt.spec.ts tests/resume-grade-service.spec.ts --reporter=dot
Get-ChildItem src/domain -Recurse -Filter *.ts | Select-String -Pattern 'AiProvider|ai\.chat\(|logger|safeJsonParse'
node bin/auto-hh --help
```

## Риски

- Модель может вернуть числа строкой или без `categoryScores` — VO обязан повторять терпимость
  прежнего кода (иначе отчёт по оценке резюме поедет).
- Живой прогон `grade` не запускается: нужен ключ ИИ. Замена — фейковый `AiProvider` в спеках.
