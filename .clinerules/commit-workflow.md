## Commit Workflow Rules
- **Task branch from `development`**: each task (ticket) starts with its own branch cut from an up-to-date `development`:
  `git switch development && git pull --ff-only && git switch -c <type>/<ticket>-<slug>` — e.g.
  `fix/t-29-cmd-resume-exit`, `refactor/t-25-hh-adapters`; work without a ticket — `chore/<slug>`.
  All task commits go **to this branch**, `development` stays clean. When the task is finished, report the
  branch name and its commit list; merge/PR/push — only on explicit request.
- **PR body — по шаблону**: описание пулл-реквеста заполняется по [`.github/pull_request_template.md`](../.github/pull_request_template.md)
  (что в PR → проверки → не проверялось живьём), заголовок PR повторяет Conventional Commits, база — `development`.
- **Commit after every subtask**: as soon as a self-contained piece of work is done (a plan stage, a bug fix, a refactor step), commit it. Never leave finished work uncommitted while starting the next item.
- **Verify first, commit second**: run the targeted checks for that subtask (`npx tsc --noEmit`, `npm run arch`, the single related test file) and commit only when they pass. `npm run lint` is a **final** check — run it once at the end of the task, not in every subtask commit. If a check cannot be run, say so in the commit body.
- **One intent per commit**: do not mix storage/infra changes with behavior changes, formatting or dependency bumps. If one file belongs to two commits, stage hunks (`git add -p`).
- **Conventional Commits, Russian subject**: `<type>(<scope>): <summary>` — e.g. `feat(sqlite): кэш и история в SQLite`, `refactor(arch): убрать env из сценариев`, `test(digest): политика и фильтр под vitest`.
  Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`.
- **Scope = layer or module**: `sqlite`, `arch`, `digest`, `cover`, `apply`, `search`, `resume`, `cli`, `deps`, `docs`, `rules`.
- **No secrets, no local state**: `.env`, `config.json`, `data/`, `*.db*`, `dist/` stay untracked.
- **No AI attribution**: no `Co-Authored-By: Claude` / `Generated with ...` trailers.
- **Commits are local**: no push, force-push, amend, rebase or merge into `development` of published commits/task branches unless explicitly requested.
- **Report progress**: after committing, reply with the short hash and subject so the user can see what is safely on disk.
- **Interrupted subtask**: commit a checkpoint (`chore(wip): <что осталось>`) instead of leaving a dirty tree, and continue in the next commit.
