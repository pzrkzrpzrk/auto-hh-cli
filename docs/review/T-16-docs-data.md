# T-16 — README и каталог `data/`

- **Приоритет:** **P0** — REVIEW.md § IV **F3**, **F4**
- **Этап:** 5 (закрывать вместе с T-02/T-14, чтобы описание соответствовало коду)
- **Зависимости:** T-02, T-14, T-13 (документировать только то, что осталось после удаления кода)
- **Объём:** только документация

## Проблема

1. **F4 — README расходится с кодом.** README ссылается на сущности, которых в репозитории нет:
   - каталог `scripts/` — README:445 («вспомогательные скрипты»), при этом `scripts/` отсутствует,
     и даже `tsconfig.json:15` держит мёртвый `include: "scripts/**/*.ts"`;
   - файл `src/oauth-server.js` — README:383; OAuth-поля из `config.ts:17-23` удаляются в T-02;
   - `src/apply-playwright.ts` указан дважды (README:441, :454) — файл существует, но это легаси-обёртка,
     судьба которой решается в T-02;
   - в дереве проекта `cmd-cover.ts` указан дважды (README:414 и :419).
2. **README устарел по CLI.** Фактически зарегистрированы 12 команд и 3 алиаса меню
   (`src/cli/index.ts:23-97`: `search`, `apply`, `digest`, `history`, `config`, `reset`, `cover`,
   `schedule`, `grade`, `resume`, `ui` + алиасы `menu`, `interactive`), и все они описаны в
   `package.json:9-27` (`search`, `digest`, `digest:show`, `cover`, `apply`, `login`, `schedule`, `ui`,
   `resume:list|show|register`, `build`, `watch`, `migrate:*`). Проверить, что README перечисляет именно
   этот набор, а не «только меню».
3. **Проверено, чего в README нет:** `data/history.json` там **не** упоминается (grep по README) —
   значит править этот пункт не нужно, история откликов упоминается только в коде
   (`src/cli/cmd-history.ts:7`, см. F2/T-14).
4. **F3 — про каталог `data/` нет предупреждения.** В git ничего не утечёт: `data/` в `.gitignore:3`,
   `git ls-files data` → 0 файлов. Но физически в проекте лежит `data/browser-profile` с cookies
   **живой сессии hh.ru** — это персональные данные аккаунта, и об этом в README не сказано.

## Что сделать

- [x] Сверить структуру `src/` в README с фактической (37 файлов) и обновить список модулей/шагов;
      убрать дубликат `cmd-cover.ts` (README:414, :419).
- [x] Убрать упоминания `scripts/` (README:445) и `src/oauth-server.js` (README:383);
      из `tsconfig.json:15` убрать `scripts/**/*.ts` (мёртвый `include`).
- [x] Описать реальный CLI: подкоманды + меню `ui`/`menu`/`interactive`; перечислить npm-скрипты
      из `package.json:9-27` (`npm start`, `npm run search|digest|digest:show|cover|apply|login|schedule|ui`,
      `npm run resume:*`, `npm run build`, `npm run watch`, `npm run migrate:up|down|create`).
- [x] Определиться с легаси-точкой входа `src/apply-playwright.ts`: если T-02 её удаляет — убрать
      README:441 и :454 (и упоминание селекторов в :454 заменить на `src/cli/cmd-apply.ts`).
- [x] Добавить раздел про данные и безопасность:
      - `data/` не коммитится (`.gitignore:3`);
      - `data/browser-profile` содержит cookies сессии hh.ru — **не** копировать в бэкапы/архивы/чаты,
        при утечке отзывать сессию на hh.ru;
      - `data/app.log` (`src/logger.ts:5`) может содержать заголовки вакансий и текст писем.
- [x] Обновить раздел про env: `HH_CLIENT_ID/SECRET/REDIRECT_URI/ACCESS_TOKEN/REFRESH_TOKEN/RESUME_ID`
      больше не читаются кодом (T-02) — либо удалить, либо явно помечать «зарезервировано, не используется».
- [x] Сверить список env-переменных с реально читаемыми: `HH_USER_AGENT`, `REQUEST_DELAY_MS`,
      `CONFIG_PATH`, `PW_USER_DATA_DIR`, `PW_HEADLESS`, `PW_MIN_DELAY_MS`, `PW_MAX_DELAY_MS`,
      `PW_TEST_MODE`, `PW_TEST_TIMEOUT_MS`, `PW_MANUAL_TIMEOUT_MS`, `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`,
      `CLAUDE_MODEL`, `APPLICANT_PROFILE`, `COVER_SIGNATURE`, `RESUME_PATH`, `RESUMES_DIR`,
      `MONGODB_URI`, `MONGODB_TIMEOUT_MS`, `JUDGE_BATCH_SIZE`, `COVER_BATCH_SIZE`, `DEBUG`.

## Definition of Done

- [x] Ни одного упоминания `scripts/` и `oauth-server.js` в README; `tsconfig.json` не ссылается на
      несуществующий каталог.
- [x] README описывает CLI так же, как код: 12 команд + алиасы меню, список совпадает с `index.ts:23-97`.
- [x] Есть явное предупреждение про `data/browser-profile` и `data/app.log`.
- [x] Список env-переменных совпадает с тем, что реально читает код (сверить с `.env.example` и `src/`).

## Проверка

```powershell
Select-String -Path README.md -Pattern 'scripts/|oauth-server|apply-playwright|HH_CLIENT_ID'
Get-ChildItem src,config.json,.env.example -Recurse -Include *.ts,*.json,.example |
  Select-String -Pattern 'HH_CLIENT_ID|process\.env\.'
git check-ignore -v data
git ls-files data
```

## Риски

Отсутствуют: тикет не меняет код (кроме удаления мёртвого `include` в `tsconfig.json` — после этого
обязательно `npx tsc --noEmit`). Единственное требование — писать **только** то, что подтверждается
кодом или `.env.example`, иначе README снова разойдётся с реальностью (именно так возникли F4 и
устаревший комментарий в `src/cli/index.ts:1`, удаляемый в T-02).

## Реализовано

Правки только в `README.md` и `tsconfig.json`.

1. **`scripts/` и `oauth-server.js`** удалены из README; из `tsconfig.json` убрано мёртвое
   `include: "scripts/**/*.ts"` → `"include": ["src/**/*.ts", "app.ts"]` (tsc после правки — exit 0).
2. **Структура проекта:** убран дубликат `cmd-cover.ts` (стало одной строкой «шаг 3: сопроводительные —
   весь дайджест или один vacancyId»), добавлены реально существующие `app.ts` (легаси-обёртка
   `node app.js` = `auto-hh search`) и каталог `data/` (в `.gitignore`). Список `src/` сверен с 37 файлами:
   все 12 команд, три клиента, пять модулей `domain/`, пять `store/` и корневые `apply-playwright.ts`,
   `resume.ts`, `config.ts`, `logger.ts`, `retry.ts`, `text-utils.ts`, `types.ts` на месте.
3. **CLI и npm-скрипты:** набор из 12 команд в README совпал с фактическим выводом
   `npx tsx bin/auto-hh --help` (12 команд, exit 0) — правок не потребовалось. В таблицу npm-скриптов
   добавлен пропущенный `npm run watch` (`tsc --watch` из `package.json`).
4. **`src/apply-playwright.ts`:** T-02 (удаление мёртвого кода) не выполнялся в этой итерации, файл
   существует и остаётся рабочей легаси-точкой входа — в README он описан как есть.
   Строка про селекторы (README:454) исправлена: массивов `respondSelectors`/`submitSelectors` в коде
   **не существует**, реальные точки правки — `src/cli/cmd-apply.ts` (`selectors` для кнопки отклика,
   `textareaSel` для поля письма, `data-qa`-атрибуты в скрипте подтверждения).
5. **Раздел про env:** OAuth-переменные переформулированы честно — они читаются
   `src/config.ts` (`env()`), но ни одна команда их не использует (сценарий OAuth не задействован).
   Список из 27 переменных, читаемых кодом (`process.env.*` по `src/` + `app.ts` + `bin/auto-hh`),
   совпадает с README; лишних в README нет. Для полной согласованности в `.env.example` добавлены три
   реально читаемые, но забытые в шаблоне переменные: `OPENAI_API_KEY` (запасной ключ, который
   README уже описывает), `PW_MANUAL_TIMEOUT_MS` и `DEBUG`.
6. **Предупреждение о данных** добавлено в раздел «Файлы в `data/`»: `data/` не коммитится
   (`git check-ignore -v data` → `.gitignore:3`, `git ls-files data` → 0 файлов), но
   `data/browser-profile/` содержит cookies живой сессии hh.ru (персональные данные — не копировать
   в архивы/бэкапы/чаты, при утечке отозвать сессии), а `data/app.log` может содержать заголовки вакансий
   и текст писем; дампы `apply-dom-*.html` тоже перечислены.

### Проверки

- `npx tsc --noEmit` → exit 0 (после правки `tsconfig.json`).
- `Select-String -Path README.md -Pattern 'scripts/|oauth-server|respondSelectors'` → 0 совпадений;
  `apply-playwright` — 1 совпадение (существующий файл), `HH_CLIENT_ID` — 1 совпадение (переформулированный
  раздел «Зарезервировано»).
- `npx tsx bin/auto-hh --help` → 12 команд, exit 0; `git check-ignore -v data` → `.gitignore:3`,
  `git ls-files data` → пусто.
