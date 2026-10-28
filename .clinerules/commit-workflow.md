## Commit Workflow Rules
- **Commit after every subtask**: as soon as a self-contained piece of work is done (a plan stage, a bug fix, a refactor step), commit it. Never leave finished work uncommitted while starting the next item.
- **Verify first, commit second**: run the targeted checks for that subtask (`npx tsc --noEmit`, `npm run arch`, the single related test file) and commit only when they pass. If a check cannot be run, say so in the commit body.
- **One intent per commit**: do not mix storage/infra changes with behavior changes, formatting or dependency bumps. If one file belongs to two commits, stage hunks (`git add -p`).
- **Conventional Commits, Russian subject**: `<type>(<scope>): <summary>` — e.g. `feat(sqlite): кэш и история в SQLite`, `refactor(arch): убрать env из сценариев`, `test(digest): политика и фильтр под vitest`.
  Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`.
- **Scope = layer or module**: `sqlite`, `arch`, `digest`, `cover`, `apply`, `search`, `resume`, `cli`, `deps`, `docs`, `rules`.
- **No secrets, no local state**: `.env`, `config.json`, `data/`, `*.db*`, `dist/` stay untracked.
- **No AI attribution**: no `Co-Authored-By: Claude` / `Generated with ...` trailers.
- **Commits are local**: no push, force-push, amend or rebase of published commits unless explicitly requested.
- **Report progress**: after committing, reply with the short hash and subject so the user can see what is safely on disk.
- **Interrupted subtask**: commit a checkpoint (`chore(wip): <что осталось>`) instead of leaving a dirty tree, and continue in the next commit.
