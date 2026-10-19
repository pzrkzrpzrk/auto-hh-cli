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

- [x] `domain/ports.ts`: `DataJanitor { clearAll(): Promise<ResetSummary> }`,
      `ResumeFiles { ensureDir(); list(); load(name?); pathFor(name, kind); exists(file);
      save(name, markdown, { overwrite? }) }` — пути `.md`/`pdf`, проверка существования и флаг
      «пропущено» остались в адаптере: сценарий не должен знать раскладку каталога.
- [x] `domain/ports.ts` (или `domain/search`): `SearchReportWriter { write(entries, opts): Promise<SearchFileResult[]> }`.
- [x] `infrastructure/files/data-janitor.ts`: текущая логика из `reset.ts` (`removeFlat`, `removeRecursive`,
      `clearMongoCollection`) переезжает сюда без изменения поведения.
- [x] `infrastructure/files/resume-files.ts`: `list/load/ensureDir/save/pathFor/exists` поверх `resume-loader`;
      заодно реализует `ResumeProvider`, поэтому `resume-file-source.ts` удалён (один адаптер на все сценарии).
- [x] `infrastructure/files/search-report-writer.ts`: обёртка над `writeSearchResults` (формат файла не менялся).
- [x] `application/reset.ts`, `resume-download.ts`, `resume.ts`, `history.ts` — только оркестрация
      и тексты исходов; `fs`/`path`/`mongo/*` из `application` уходят.
- [x] `SearchScenario` перестаёт импортировать `reset.ts` — сброс приходит через `deps.janitor`.

**Выполнено (2026-10-19).** В `SearchDeps` добавлены `janitor` и `reportWriter` (стадия выдачи получает
писателя через `SearchContext.writer`). `ResumeRegistry` расширен `listRegistered()` — список резюме
по-прежнему показывает дату регистрации, но Mongo-запрос идёт через порт. `composition.ts` собирает
`resetDeps`, `historyDeps`, `resumeDeps`, `resumeDownloadDeps`; команды `reset`/`history`/`resume`/
`resume-download` только передают их. Поведение сохранено: те же регулярки и коллекции при сбросе,
тот же порядок «сброс → открытие источника», те же события и тексты скачивания резюме.

## Definition of Done

- [x] `Get-ChildItem -Recurse -File src\application -Filter *.ts | Select-String -Pattern 'from \"fs\"|from \"path\"|mongo/'` → пусто
      (кроме type-only импортов, которых быть не должно).
- [x] `npx tsc --noEmit` → exit 0.
- [x] Поведение не изменилось: `reset` удаляет те же файлы и те же коллекции, печатает ту же сводку
      (`formatResetSummary`), `search --reset` по-прежнему сбрасывает данные **до** открытия браузера.

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem -Recurse -File src\application -Filter *.ts | Select-String -Pattern 'from "fs"|from "path"|mongo/'
npx tsx bin/auto-hh ui   # «Сброс данных» → отказ (confirm=false) ничего не меняет
```

## Риски

- `reset` — необратимая операция: переносить код нужно **без правок**, только меняя владельца.
  Регулярки имён (`/^(history|digest|rejected)[.-]/`) и список коллекций — инвариант из
  `docs/architecture.md:409-411`.
- `resume-download` пишет `.md` + опционально `.pdf`; имена файлов (`<фамилия-имя>-<hash>.md`)
  менять нельзя — на них завязаны `resumeId` в Mongo.
