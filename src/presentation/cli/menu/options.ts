// Сборка opts для команд из ответов меню: одна копия на все шаги меню.
// Здесь только «ответы → параметры команды»: без промптов, ввода-вывода и побочных эффектов.

/** Собирает opts для `search` (шаг только поиска): резюме и ИИ ему больше не нужны. */
export function buildSearchOptions(answers: { reset: boolean }): Record<string, any> {
  return { reset: answers.reset };
}

/** Собирает opts для `digest` (шаг отбора): limit=0 → лимит из config.json. */
export function buildDigestOptions(answers: {
  resume?: string;
  useAi: boolean;
  limit: number;
  dryRun?: boolean;
}): Record<string, any> {
  const opts: Record<string, any> = {
    resume: answers.resume,
    claude: answers.useAi,
    dryRun: answers.dryRun ?? false,
  };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}

/** Собирает opts для `cover` (шаг писем): limit=0 → все вакансии дайджеста. */
export function buildCoverOptions(answers: { resume?: string; force: boolean; limit: number }): Record<string, any> {
  const opts: Record<string, any> = { resume: answers.resume, force: answers.force };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}

/** Собирает opts для `apply` из ответов меню: limit=0 означает «без лимита». */
export function buildApplyOptions(answers: { type: string; limit: number }): Record<string, any> {
  const opts: Record<string, any> = { type: answers.type };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}
