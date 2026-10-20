# T-24 — Домен без побочек: политики в домен, логи и запись — в стадии

- **Приоритет:** **P2** — SRP внутри слоёв, без изменения поведения
- **Этап:** 9
- **Зависимости:** T-17, T-18; ветка `refactor/t24-domain-purity` базируется на T-23 (`strict` + `arch`)
- **Объём:** 6 файлов домена + 7 файлов `application` (включая перенос и переименование)
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

1. **Побочные эффекты в домене**:
   - `domain/digest/DigestEntryFactory.ts:37-43` — вызывает `history.markApplied(...)` (запись в Mongo);
   - `domain/digest/DigestMatcher.ts:31,37,51`, `DigestEntryFactory.ts:45` — логируют (логгер пишет в файл);
   - `domain/grade-resume.ts:2`, `domain/judge/judge.ts:1` — логгер как зависимость домена.
2. **Доменные политики лежат в `application`**:
   - `application/search/FullCardPolicy.ts` — `SkipSeenPolicy` («просмотренные не качаем»),
     `AllVacanciesPolicy` — это правило, а не оркестрация;
   - `application/search/SearchCache.ts` — репозиторий (ок), но `flatten()` — правило выдачи.
3. **Имена врут о слое**: `application/digest/JudgementService.ts:1` называет себя
   «Domain Service», `application/search/VacancyCollector.ts:1` — тоже, хотя оба живут в `application`
   и делают I/O через порты.

## Что сделать

- [x] `DigestEntryFactory.create()` возвращает записи **без** `markApplied`; отметку истории делает
      `SelectStage` (`application/digest/stages.ts`) — там же, где уже вызывается `history.markSeen`.
- [x] `DigestMatcher` возвращает `accepted/rejected` без логов (факты — в `events`); логи печатает `SelectStage`.
- [x] `FullCardPolicy`/`SkipSeenPolicy` → `domain/search/FullCardPolicy.ts`; `VacancyCollector`
      принимает политику параметром (уже принимает) — импорт меняется на доменный.
- [x] Переименовать `JudgementService` → `DigestJudgeRunner` (шапка файла больше не утверждает «Domain Service»).
- [x] Домен не импортирует `shared/logger` (после T-21 — вообще порт логгера).

## Definition of Done

- [x] `Select-String -Path src\domain -Pattern 'shared/logger'` → пусто;
      `Select-String -Path src\domain\digest -Pattern 'markApplied|history\.|logger'` → пусто
      (порт `HistoryStore.markApplied` в `domain/ports.ts` — легальное объявление контракта).
- [x] `npx tsc --noEmit` → exit 0; `npm run arch` → 0; `npm run build` → 0.
- [x] `digest build` пишет те же записи в `digest`/`rejected`, те же строки лога — сверено на фейковых
      портах (baseline до правок vs `SelectStage` после): логи, `DigestEntry` и `markApplied` совпали,
      включая dry-run без записи истории.

## Проверка

```powershell
npm run arch
npx tsc --noEmit
Select-String -Path src\domain\digest -Pattern 'markApplied|history\.|logger'
```

## Итог (2026-10-19)

- `DigestEntryFactory` и `DigestMatcher` — без побочек: маппинг и правило отбора чистые,
  `SelectStage` печатает события и пишет историю (`digestOnly: true` сохранён).
- `FullCardPolicy` живёт в `domain/search`, импорты search/digest/cover обновлены.
- `JudgementService` → `DigestJudgeRunner`; шапки `DigestJudgeRunner`/`VacancyCollector` —
  «Application Service».
- Поведение не изменилось: формат `.md`, порядок и тексты логов, meta истории — прежние.

## Риски

- `markApplied(digestOnly: true)` — тонкий контракт с шагом `apply` (`application/apply.ts:80`):
  если отметку перенести и потерять флаг, `apply` начнёт пропускать вакансии из дайджеста.
  Проверять по `history` после `digest build`.
