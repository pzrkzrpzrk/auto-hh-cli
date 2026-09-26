# T-02 — Удаление мёртвого кода

- **Приоритет:** P2 — REVIEW.md § II **K4**
- **Этап:** 0 (гигиена)
- **Зависимости:** нет (но T-15 «Типы» удобнее делать после)
- **Объём:** 7 находок + 1 решение владельца, ~60-80 строк

## Проблема

Все кандидаты проверены grep'ом по репозиторию (см. таблицу «Что отклонено» в REVIEW.md § VII):

| Что | Где | Почему мёртвое |
|---|---|---|
| OAuth-поля `env()` | `src/config.ts:17-23` | `HH_CLIENT_ID/SECRET/REDIRECT_URI/ACCESS_TOKEN/REFRESH_TOKEN/RESUME_ID` не используются нигде; README:383 сам зовёт их зарезервированными, а `src/oauth-server.js`, на который он ссылается, в репозитории нет. Реально нужны только `userAgent` (:22) и `requestDelayMs` (:24) |
| `Verdict.coverLetter` | `src/types.ts:21`, всегда пишется пустым в `src/domain/judge/judge.ts:34` | никем не читается (промпт сам требует пустую строку) |
| Легаси-алиасы шага digest | `src/cli/cmd-digest.ts:295-306` | `SHOW_ACTIONS = ['show','last','latest','view']` (:295), ветка `typeof action === 'object'` (:299-302), алиасы `make`/`create` (:306). Меню вызывает только `cmdDigest('build', …)` (`cmd-ui.ts:222`) и `cmdDigest('show', …)` (`cmd-ui.ts:356`); ветка-объект недостижима ниоткуда (Commander всегда передаёт строку: `index.ts:41,48`), алиасы `last/latest/view/make/create` живы только через прямой вызов `auto-hh digest <alias>` |
| Экспорт без потребителей | `src/cli/cmd-digest.ts:312` | `export { build as buildDigest, show as showDigest }` никто не импортирует (проверено grep'ом по `src/`) |
| Закомментированный код | `src/domain/adapt-resume.ts:35-37` | мёртвый блок (при этом `stripHtml` со строки 4 всё ещё используется — импорт оставить) |
| `filter.requiredSkills` | `config.json:13` | не читается: `src/domain/filter.ts` использует только `excludeArchived` :30, `excludedCompanies` :35, `excludedKeywords` :45, `minSalaryRub` :50, `locationRule` :61 |
| Дублирующийся заголовочный комментарий | `src/cli/index.ts:1` и `:99-100` | строка 1 описывает файл как «регистрирует команды», строки 99-100 — про `run()`/`finally`; достаточно одного из них |

**Не удалять:** `history.isApplied` (`src/store/history-store.ts:52-56`) — оно не вызывается, но нужно
для T-07 (замена `history.load()` в цикле). Это не мёртвый код, а неиспользованная точка расширения.

**Требует решения владельца (отдельным коммитом):** `src/apply-playwright.ts` (19 строк) — легаси-обёртка
`node src/apply-playwright.js` = `auto-hh apply`; в конце зовёт `process.exit(0)` (:15) и `process.exit(1)` (:18).
Удалять (README:441 и :454 всё равно называют её легаси-точкой входа) или переписать на `exitCode` — решает владелец;
в этом тикете только зафиксировать решение, не смешивая с остальными удалениями.

## Что сделать

- [ ] `config.ts`: убрать OAuth-поля из `env()` (`:17-23`), оставить `userAgent` (:22) и `requestDelayMs` (:24).
- [ ] `types.ts` + `judge.ts`: убрать `coverLetter` из `Verdict` (:21) и из `normalizeVerdict` (`judge.ts:34`).
      Промпт в `domain/judge/system-text.ts` **не трогать** — требование `"coverLetter": ""` в ответе безопасно.
- [ ] `cmd-digest.ts`: удалить `SHOW_ACTIONS` (:295), ветку `typeof action === 'object'` (:299-302) и алиасы
      `make`/`create` (:306). **Сохранить** оба живых пути: `build` (`cmd-ui.ts:222`, `index.ts:41`) и
      `show` (`cmd-ui.ts:356`) — иначе сломается пункт меню «📄 Последний дайджест (digest show)».
- [ ] `cmd-digest.ts:312`: удалить реэкспорт.
- [ ] `adapt-resume.ts:35-37`: удалить закомментированный блок.
- [ ] `config.json:13`: удалить `filter.requiredSkills` (и синхронизировать с `config.example.json`, если он есть).
- [ ] `index.ts`: оставить один заголовочный комментарий (`:1` или `:99-100`).
- [ ] Решение по `src/apply-playwright.ts`: удалить файл **или** заменить `process.exit` на `exitCode`
      (проверить, что README поправлен в T-16).

## Definition of Done

- [ ] `npx tsc --noEmit` → exit 0.
- [ ] Повторный grep не находит удалённые идентификаторы нигде, кроме README (его приводит в порядок T-16):
      `HH_CLIENT_ID`, `Verdict.coverLetter`, `SHOW_ACTIONS`, `requiredSkills`, `buildDigest`.
- [ ] `npx tsx bin/auto-hh ui`: работают оба пункта дайджеста — «🧠 Собрать дайджест (digest)» (`build`)
      и «📄 Последний дайджест (digest show)» (`show`).
- [ ] `auto-hh digest show` из CLI тоже работает (команда зарегистрирована в `index.ts:38-48`).

## Проверка

```powershell
npx tsc --noEmit
Get-ChildItem src,config.json -Recurse -Include *.ts,*.json |
  Select-String -Pattern 'HH_CLIENT_ID|coverLetter|SHOW_ACTIONS|requiredSkills|buildDigest'
```

## Риски

Единственный неочевидный — `Verdict.coverLetter`: если внешние скрипты читают `cacheJudgements` и ждут это
поле, оно пропадёт из нормализованного объекта. В репозитории таких потребителей нет; в Mongo старые
документы останутся как есть (удаляем только код).
Отдельно: удаление алиасов `last/latest/view/make/create` меняет поведение CLI для тех, кто вызывал
`auto-hh digest view` вручную — это осознанное упрощение контракта, но его стоит упомянуть в коммите
(и в README, если команда там описана).
