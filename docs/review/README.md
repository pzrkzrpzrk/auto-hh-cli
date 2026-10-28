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
| [T-25](T-25-hh-adapters-split.md) | Разбить `hh/client.ts` (619) и `resume.ts` (399) | P2 | SRP адаптеров hh.ru | T-23 | ☐ |
| [T-26](T-26-fake-port-tests.md) | Тесты на фейковых портах (`node:test` + `tsx`) | P2 | тестируемость | T-17, T-18, T-19 | ☐ |
| [T-27](T-27-judge-cover-domain.md) | Домен `judge`/`cover-letter`: VO, Domain Services, ИИ вне домена | P2 | SRP, чистота домена, тесты | T-23, T-24 | ✅ |

**Сделано:** T-17…T-24 (issues #27…#34), T-27. **Открыто:** T-25, T-26.

Порядок: **T-17 → T-18 → T-19 → T-20** (P0, восстановить Dependency Rule), затем **T-21 → T-22 → T-23 → T-24**
(разорвать транзитивные связи, включить проверку и убрать побочки из домена), затем **T-26 → T-25**
(тесты на фейковых портах, распил адаптеров).

## Общие условия приёмки (для любого тикета)

- `npx tsc --noEmit` → **exit 0** (автотестов в проекте нет — появиться они должны в T-26).
- Поведение меню, имена env-переменных, схемы Mongo-коллекций и формат `.md`-дайджеста **не меняются**.
- Для тикетов, меняющих слои: `application` не импортирует `infrastructure` напрямую, `domain` — вообще
  ничего из внешних слоёв. Пока правило не проверяется автоматически, смотреть `Select-String` в разделе
  «Проверка» каждого тикета; после T-23 — `npm run arch`.
- Каждый тикет — отдельный коммит с сообщением `refactor(<scope>): <что>` либо `fix(...)` / `chore(...)`.

## Что нельзя проверить в этом окружении

Полный прогон требует MongoDB, Playwright-профиля с живой сессией hh.ru и ключа ИИ. Доступны безопасные
ручные проверки: вывод `config`, `digest show` (чтение Mongo), ветка ошибки `cover` без ключа, отмена промптов (Ctrl+C).
Сценарии, переведённые на порты (T-17…T-22), проверяются смоук-тестом на фейковых зависимостях —
без базы, браузера и ключа.
