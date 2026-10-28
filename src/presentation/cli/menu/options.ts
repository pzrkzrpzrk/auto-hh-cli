// Сборка opts для команд из ответов меню: одна копия на все шаги меню.
// Здесь только «ответы → параметры команды»: без промптов, ввода-вывода и побочных эффектов.
import type { ApplyOptions, CoverOptions, SearchOptions } from "@/application/options.js";
import type { DigestRunOptions } from "@/application/digest.js";

/** Собирает opts для `search` (шаг только поиска): резюме задаёт папку артефактов. */
export function buildSearchOptions(answers: { reset: boolean; resume?: string }): SearchOptions {
  const opts: SearchOptions = { reset: answers.reset };
  if (answers.resume) opts.resume = answers.resume;
  return opts;
}

/** Собирает opts для `digest` (шаг отбора): limit=0 → лимит из config.json. */
export function buildDigestOptions(answers: {
  resume?: string;
  useAi: boolean;
  limit: number;
  dryRun?: boolean;
}): DigestRunOptions {
  const opts: DigestRunOptions = {
    resume: answers.resume,
    claude: answers.useAi,
    dryRun: answers.dryRun ?? false,
  };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}

/** Собирает opts для `cover` (шаг писем): limit=0 → все вакансии дайджеста. */
export function buildCoverOptions(answers: { resume?: string; force: boolean; limit: number }): CoverOptions {
  const opts: CoverOptions = { resume: answers.resume, force: answers.force };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}

/** Собирает opts для `apply` из ответов меню: limit=0 означает «без лимита». */
export function buildApplyOptions(answers: { type: string; limit: number; resume?: string }): ApplyOptions {
  const opts: ApplyOptions = { type: answers.type };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  if (answers.resume) opts.resume = answers.resume;
  return opts;
}
