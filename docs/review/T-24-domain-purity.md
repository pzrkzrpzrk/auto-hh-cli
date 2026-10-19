# T-24 — Домен без побочек: политики в домен, логи и запись — в стадии

- **Приоритет:** **P2** — SRP внутри слоёв, без изменения поведения
- **Этап:** 9
- **Зависимости:** T-17, T-18 (после них виден реальный объём домена)
- **Объём:** 4 файла домена + 3 файла `application`
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

- [ ] `DigestEntryFactory.create()` возвращает записи **без** `markApplied`; отметку истории делает
      `SelectStage` (`application/digest/stages.ts:130-131`) — там же, где уже вызывается
      `history.markSeen`.
- [ ] `DigestMatcher` возвращает `accepted/rejected` без логов; логи переносятся в `SelectStage`.
- [ ] `FullCardPolicy`/`SkipSeenPolicy` → `domain/search/FullCardPolicy.ts`; `VacancyCollector`
      принимает политику параметром (уже принимает) — импорт меняется на доменный.
- [ ] Переименовать `JudgementService` → `DigestJudgeRunner` (или оставить имя, но поправить шапку файла,
      чтобы она не утверждала «Domain Service»).
- [ ] Домен не импортирует `shared/logger` (после T-21 — вообще порт логгера).

## Definition of Done

- [ ] `Select-String -Path src\domain -Pattern 'shared/logger|markApplied|history\.'` → пусто.
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] `digest build` пишет те же записи в `digest`/`rejected`, те же строки лога (проверить на фейковых
      портах или по count в Mongo).

## Проверка

```powershell
npx tsc --noEmit
Select-String -Path src\domain -Pattern 'logger|markApplied'
npm run arch
```

## Риски

- `markApplied(digestOnly: true)` — тонкий контракт с шагом `apply` (`application/apply.ts:80`):
  если отметку перенести и потерять флаг, `apply` начнёт пропускать вакансии из дайджеста.
  Проверять по `history` после `digest build`.
