# T-20 — Файловый I/O из `application` в адаптеры (`reset`, `resume-download`, `search/stages`)

- **Приоритет:** **P0** — I/O в слое сценариев (Dependency Rule + SRP)
- **Этап:** 8
- **Зависимости:** нет
- **Объём:** 2 новых порта + 2 адаптера, 4 файла сценариев
- **Пути:** актуальные, состояние на 2026-10-19

## Проблема

| Файл | Что делает с I/O | Чем должен быть |
|---|---|---|
| `application/reset.ts:2-6,38-66` | `fs.readdirSync/unlinkSync/rmdirSync` + `dbInstance().collection().deleteMany` | сценарий «сбросить данные» поверх порта |
| `application/resume-download.ts:5-11` | `fs`/`path`, `ensureResumesDir`, `registerResume` | сценарий поверх портов `ResumeFiles` + `ResumeRegistry` |
| `application/search/stages.ts:3` | `writeSearchResults` (файл `.md`) | стадия возвращает данные через порт |
| `application/resume.ts:3-7` | `listResumes`/`loadResume` + `resume-store` | поверх порта `ResumeFiles` |
| `application/history.ts:3` | дефолтный синглтон `history-store` | поверх порта `HistoryStore` |

`reset.ts` — это не use case, а **адаптер очистки**: он знает раскладку `data/` (4 каталога),
регулярки имён файлов и имена Mongo-коллекций. Ровно поэтому `SearchScenario` зависит от `resetData`
(`application/search/SearchScenario.ts:4,35`): поиск тянет за собой знание о файловой системе.

## Что сделать

- [ ] `domain/ports.ts`: `DataJanitor { clearAll(): Promise<ResetSummary> }`,
      `ResumeFiles { list(): ResumeListItem[]; load(name?): Resume | null; ensureDir(): string;
      save(name, markdown, pdf?): Resume }`.
- [ ] `domain/ports.ts` (или `domain/search`): `SearchReportWriter { write(entries, date): Promise<SearchFileResult> }`.
- [ ] `infrastructure/files/data-janitor.ts`: текущая логика из `reset.ts` (`removeFlat`, `removeRecursive`,
      `clearMongoCollection`) переезжает сюда без изменения поведения.
- [ ] `infrastructure/files/resume-files.ts`: `list/load/ensureDir/save` поверх `resume-loader`.
- [ ] `application/reset.ts`, `resume-download.ts`, `resume.ts`, `history.ts` — только оркестрация
      и тексты исходов; `fs`/`path`/`mongo/*` из `application` уходят.
- [ ] `SearchScenario` перестаёт импортировать `reset.ts` — сброс приходит через `deps.janitor`.

## Definition of Done

- [ ] `Select-String -Path src\application -Pattern 'from \"fs\"|from \"path\"|mongo/'` → пусто
      (кроме type-only импортов, которых быть не должно).
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] Поведение не изменилось: `reset` удаляет те же файлы и те же коллекции, печатает ту же сводку
      (`formatResetSummary`), `search --reset` по-прежнему сбрасывает данные **до** открытия браузера.

## Проверка

```powershell
npx tsc --noEmit
Select-String -Path src\application -Pattern 'from "fs"|from "path"'
npx tsx bin/auto-hh ui   # «Сброс данных» → отказ (confirm=false) ничего не меняет
```

## Риски

- `reset` — необратимая операция: переносить код нужно **без правок**, только меняя владельца.
  Регулярки имён (`/^(history|digest|rejected)[.-]/`) и список коллекций — инвариант из
  `docs/architecture.md:409-411`.
- `resume-download` пишет `.md` + опционально `.pdf`; имена файлов (`<фамилия-имя>-<hash>.md`)
  менять нельзя — на них завязаны `resumeId` в Mongo.
