## Verification & Terminal Output Rules

Стек проекта: TypeScript (`nodenext`, `strict`), Node.js ≥ 22.13, CLI на `tsx`,
тесты на vitest (`tests/**/*.spec.ts`, `vitest.config.mts`), границы слоёв —
dependency-cruiser (`.dependency-cruiser.js`). ESLint, Prettier, Vue и jest
в проекте **нет** — не вызывай их и не добавляй ради проверки. Оболочка —
PowerShell (Windows): `head`/`tail` и bash-идиомы не работают.

### Команды проверки (только они)

| Что проверяем | Команда | Область |
| --- | --- | --- |
| Типы исходников | `npx tsc --noEmit` | `src/**/*.ts` + `scripts/**/*.ts`, без записи в `dist/` |
| Типы тестов | `npm run test:types` (`tsc -p tests`) | `tests/**/*.ts` со своим `tests/tsconfig.json` |
| Один файл тестов | `npx vitest run tests/<файл>.spec.ts --reporter=dot` | только изменённый спек |
| Один кейс | `npx vitest run tests/<файл>.spec.ts -t "<имя теста>"` | точечно, пока кейс падает |
| Границы слоёв | `npm run arch` (`depcruise src`) | нарушения → `error`, exit ≠ 0 |
| CLI живой | `node bin/auto-hh --version` → `1.0.0`, `node bin/auto-hh --help` | smoke без сети |

### Что запрещено как «проверка»

- `npm run build` (`npm run arch && tsc` в `dist/`) и полный `npm test`
  (`vitest run` по всему каталогу) — только по прямой просьбе или как финальный
  прогон этапа, и тогда с `| Select-Object -Last 30`.
- Реальные прогоны `search` / `digest` / `cover` / `apply` / `resume-download`:
  они ходят в hh.ru через Playwright, тратят лимит ИИ, пишут в `data/` и могут
  блокировать аккаунт. Логику проверяем тестами на фейковых портах.
- `npm start` / `npm run ui` — интерактивное меню блокирует терминал.
- Линтеры, которых нет в `package.json`; не добавляй зависимости ради проверки.
- Чтение `.env` / `config.json` в тестах: юнит-тестам env не нужен, настройки
  передаются параметром.

### Матрица «что правил → что гоняешь»

| Изменение | Обязательный минимум |
| --- | --- |
| `src/domain`, `src/shared` | `npx tsc --noEmit` + спеки затронутых правил |
| `src/application/**` | `npx tsc --noEmit` + `npm run arch` + спеки сценария/стадии |
| `src/infrastructure/**` (SQLite, Playwright, AI, файлы) | `npx tsc --noEmit` + `npm run arch` + спеки адаптера на `:memory:`/tmp |
| `src/presentation/**`, команды и меню | `npx tsc --noEmit` + `node bin/auto-hh --help` |
| новые файлы или импорты между слоями | `npm run arch` **всегда**: цикл или импорт не в ту сторону валит проверку |
| `tests/**` | `npm run test:types` + адресный `npx vitest run tests/<файл>.spec.ts` |
| env-ключи (`src/infrastructure/config`, `.env.example`) | `npx tsc --noEmit` + сверить `.env.example` и `README.md`, секретов не добавлять |

### Правила для тестов

- Новый спек — `tests/<тема>.spec.ts`, имя по проверяемому модулю
  (`DigestPolicy` → `digest-policy.spec.ts`).
- Импорт исходников — через алиас `@/...js`: vitest срезает `.js`,
  `tests/tsconfig.json` повторяет пути сборки.
- SQLite — только `connect({ file: ':memory:' })`; файлы — во временный каталог;
  время и случайность — через инъекцию, без реальных пауз (`NoPacing`).
- ИИ-судья и сеть — детерминированные фейковые стратегии/порты, без ключей
  и живых запросов.
- Тест должен падать на сломанном поведении: проверяй исход и события, а не текст лога.

### Гигиена вывода (PowerShell)

- Длинный вывод обрезай: `... 2>&1 | Select-Object -Last 30` (или `-First 30`),
  для vitest — `--reporter=dot`.
- Код возврата смотри явно: `npm run arch 2>&1 | Out-Null; "arch exit=$LASTEXITCODE"` —
  иначе баннер `npm` маскирует падение.
- Не запускай `npm run watch` (`tsc --watch`) как проверку — процесс не завершится.

### Definition of done

- Проверка пройдена только при exit code 0 по всем строкам матрицы.
- В отчёте перечисли, что именно запускал (команда + результат), а не «всё ок».
- Если проверку выполнить нельзя (нужен живой hh.ru, ИИ-ключ, сеть) — скажи прямо,
  что она не запускалась, и укажи замену (фейковые порты, smoke `--help`).
- `dist/`, `data/`, `*.db*`, `.env`, `config.json` после проверок не коммитятся.
