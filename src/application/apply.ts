// Сценарий отклика: точка входа для команды и обратная совместимость runApply().
// Вся оркестрация — ApplyScenario (фасад) + конвейер стадий в application/apply/.
import { ApplyScenario } from "./apply/ApplyScenario.js";
import type { ApplyDeps, ApplyOutcome } from "./apply/ApplyDeps.js";

// Совместимость: composition root и команда импортируют типы из этого модуля.
export type { ApplyDeps, ApplyOutcome, ApplySettings } from "./apply/ApplyDeps.js";

/**
 * Отклик на вакансии дайджеста.
 * opts: { type?: 'latest' | 'all'; limit?: number; login?: boolean } — те же флаги, что у команды.
 */
export async function runApply(
  opts: Record<string, any> = {},
  deps: ApplyDeps,
): Promise<ApplyOutcome> {
  return new ApplyScenario(deps).run(opts);
}

