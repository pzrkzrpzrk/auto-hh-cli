<!--
Шаблон PR. Заполняй по фактам и по-русски; HTML-комментарии в готовом PR не видны.

Заголовок PR — Conventional Commits с русским subject:
  refactor(adapt-resume): разложить модуль на термины, секции и отбор
  test(digest): политика и фильтр на фейковых портах
  fix(cli): не терять меню после ошибки шага
Тип: feat | fix | refactor | perf | test | docs | chore | build
Scope: слой или модуль (sqlite, arch, digest, cover, apply, search, resume, cli, deps, docs, rules).

Ветка: <type>/<ticket>-<slug> от актуального development, база PR — development.
Один PR — одна задача. Чужая работа в diff попадать не должна (проверь: Files changed).
-->

## Что в PR

<!-- 1–3 предложения: какую задачу закрывает и зачем. Дальше — по частям (тикет/модуль). -->

Закрывает **T-XX** — <короткая суть> (`docs/review/T-XX-<slug>.md`).

### <Тикет или модуль 1>

<!-- Что изменено и почему: файл → что стало. Числа помогают ревьюеру: было/стало строк, тестов. -->

- …
- …

### <Тикет или модуль 2>

- …

## Проверки

<!-- Только команды из .clinerules/verification.md. В отчёте — команда + результат, а не «всё ок». -->

| Команда | Результат |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm run test:types` | exit 0 |
| `npm run arch` | 0 нарушений (N модулей / M связей) |
| `npx vitest run` | N файлов / M тестов — зелёные |
| `npm run lint` | 0 problems |
| `node bin/auto-hh --version` / `--help` | <результат, если трогал presentation> |

**Не проверялось живьём:** `search` / `digest` / `cover` / `apply` / `resume-download` — нужны профиль
hh.ru, ключ ИИ и расход лимита откликов. Замена — тесты на фейковых портах и smoke `--help`.

<!-- Если что-то требует ручного подтверждения — напиши здесь прямо и перечисли, что проверить руками. -->

