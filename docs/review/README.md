# Тикеты auto-hh-cli

Каталог ведёт **актуальную** серию — аудит по Clean Architecture (R. C. Martin).

Предыдущая серия KISS/DRY (T-01…T-16, источник — [`REVIEW.md`](../../REVIEW.md)) снята
с сопровождения: тикеты реализованы и удалены из каталога. По T-03/T-09/T-11 оставались только
ручные проверки за владельцем (TTY-прогон меню, генерация писем с реальным ключом ИИ) — на код
это не влияет. Номера строк в удалённых тикетах описывали состояние дерева на коммите `c58e6dc`.

## Тикеты по аудиту Clean Architecture (2026-10-19)

Аудит по R. C. Martin: Dependency Rule, use cases без I/O и фреймворков, порты/адаптеры,
composition root, тестируемость. Исходные факты на 2026-10-19: `application → infrastructure` — 26 импортов
в 12 файлах, `shared → infrastructure` — 3 файла, `presentation → infrastructure` — 4 файла, тестов нет,
`strict: false`, ~175 токенов `any`.

После T-17…T-24: прямых импортов инфраструктуры в `application`/`presentation` нет;
`shared` и `domain` тоже не импортируют инфраструктуру. `npm run arch` (dependency-cruiser) → 0 нарушений;
`strict: true` и `npx tsc --noEmit` → exit 0. Домен без побочек: `markApplied` и логи дайджеста — в `SelectStage`.

### Перепроверка 2026-10-28

[`REVIEW.md`](../../REVIEW.md) переписан под текущее дерево (SQLite, tests, T-27). Что изменилось:

- состояние проверок: `tsc` → 0, `arch` → 0 (171 модуль, 648 зависимостей), `test:types` → 0,
  `vitest` → 9 файлов / 50 тестов;
- серия KISS/DRY (D1–D14, K1–K6) закрыта: 12 пунктов полностью, D3 и D13 — частично (остался
  `domain/grade-resume`), K3 (cron) открыт заново тикетом T-30;
- из функциональных рисков остался дрейф документации (T-31); `process.exit` в `cmd-resume` снят
  в T-29;
- новые находки R1–R8 разложены по тикетам T-28…T-31 и в задачи T-25/T-26 (типизация и тесты).

| ID | Тикет | Приоритет | Покрывает | Зависит от | Статус |
|---|---|---|---|---|---|
| [T-17](T-17-apply-ports.md) | `apply.ts` за порты: Playwright/Mongo → адаптеры | P0 | Dependency Rule, I/O в use case | — | ✅ |
| [T-18](T-18-cover-ports.md) | `cover.ts` на существующие порты | P0 | Dependency Rule, порты протекают | — | ✅ |
| [T-19](T-19-config-provider.md) | `ConfigProvider` вместо `loadConfig()` и мутации env | P0 | скрытые зависимости, глобальное состояние | T-18 (✅) | ✅ |
| [T-20](T-20-file-ports.md) | Файловый I/O из `application` в адаптеры | P0 | `reset`, `resume-download`, `search/stages` | — | ✅ |
| [T-21](T-21-shared-decoupling.md) | `shared` без инфраструктуры, домен без `process.env` | P1 | транзитивная утечка в домен | T-17 (✅), T-18 (✅) | ✅ |
| [T-22](T-22-composition-scheduler.md) | Единый composition root + порт `Scheduler` | P1 | `node-cron` в use case, 4 импорта в CLI | T-17, T-18, T-20 | ✅ |
| [T-23](T-23-boundary-guard.md) | `dependency-cruiser` + `strict: true` | P1 | защита правил от дрейфа | T-17…T-22 | ✅ |
| [T-24](T-24-domain-purity.md) | Домен без побочек, политики в домен | P2 | SRP, `markApplied` из домена | T-17, T-18 | ✅ |
| [T-25](T-25-hh-adapters-split.md) | Разбить `hh/client.ts` (737) и `hh/resume.ts` (664) | P2 | SRP адаптеров hh.ru | T-23 | ☐ |
| [T-26](T-26-fake-port-tests.md) | Тесты на фейковых портах (vitest) для сценариев и адаптеров | P2 | тестируемость, R3 | T-17, T-18, T-19 | ☐ |
| [T-27](T-27-judge-cover-domain.md) | Домен `judge`/`cover-letter`: VO, Domain Services, ИИ вне домена | P2 | SRP, чистота домена, тесты | T-23, T-24 | ✅ |
| [T-28](T-28-grade-resume-service.md) | `domain/grade-resume`: Domain Service, VO оценки, ИИ в `application` | **P1** | R1: домен с I/O, второй парсер JSON | T-24, T-27 | ☐ |
| [T-29](T-29-presentation-exit.md) | `presentation`: `exitCode` вместо `process.exit`, без commander-легаси | **P1** | R2: процесс умирает из меню | — | ✅ |
| [T-30](T-30-scheduler-next-run.md) | `Scheduler.nextRun()` вместо самописного cron | P2 | R6: свой парсер cron | T-22, T-26 | ☐ |
| [T-31](T-31-docs-config-debt.md) | Документация и мёртвая конфигурация | P2 | R4, R5: README/`architecture.md`/`env()` | — | ☐ |

**Сделано:** T-17…T-24 (issues #27…#34), T-27, T-29.
**Открыто:** T-25, T-26 (по P2) и T-28, T-30, T-31 из перепроверки 2026-10-28.

Порядок: **T-28** (снимает последний P1 из [`REVIEW.md`](../../REVIEW.md)), затем **T-26 → T-25**
(тесты на фейковых портах, распил адаптеров), затем **T-30 → T-31** (cron и документация; друг от
друга не зависят).

## Общие условия приёмки (для любого тикета)

- `npx tsc --noEmit` → **exit 0**; типы тестов — `npm run test:types` → exit 0; адресный спек —
  `npx vitest run tests/<файл>.spec.ts --reporter=dot`. Полный `npx vitest run` — финальный прогон этапа,
  а не каждой правки (сейчас 8 файлов / 46 тестов).
- Поведение меню, имена env-переменных, схема SQLite (`cache_pages`, `cache_full`, `cache_judgements`,
  `cache_cover_letters`, `history`, `digests`, `resumes`) и формат `.md`-дайджеста **не меняются**.
- Новый спек — `tests/<тема>.spec.ts`; SQLite — только `connect({ file: ':memory:' })`; время и
  случайность — через инъекцию, без реальных пауз; ИИ и сеть — детерминированные фейковые порты.
- Для тикетов, меняющих слои: `application` не импортирует `infrastructure` напрямую, `domain` — вообще
  ничего из внешних слоёв. Пока правило не проверяется автоматически, смотреть `Select-String` в разделе
  «Проверка» каждого тикета; после T-23 — `npm run arch`.
- Каждый тикет — отдельный коммит с сообщением `refactor(<scope>): <что>` либо `fix(...)` / `chore(...)`.

## Что нельзя проверить в этом окружении

Полный прогон требует Playwright-профиля с живой сессией hh.ru и ключа ИИ (SQLite — локальный файл
`data/autohh.db`, отдельный сервер не нужен). Доступны безопасные ручные проверки: вывод `config`,
`resume list/show` (чтение файлов), ветка ошибки `cover` без ключа, отмена промптов (Ctrl+C).
Сценарии, переведённые на порты (T-17…T-22), проверяются смоук-тестом на фейковых зависимостях —
без базы, браузера и ключа.
