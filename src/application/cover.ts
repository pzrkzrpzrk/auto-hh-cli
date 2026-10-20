// Сценарий сопроводительных писем: точка входа для команды и обратная совместимость runCover().
// Вся оркестрация — CoverScenario (фасад) + режимы и конвейер стадий в application/cover/.
import { CoverScenario } from "@/application/cover/CoverScenario.js";
import type { CoverDeps, CoverOutcome, OnVacancy } from "@/application/cover/CoverDeps.js";

// Совместимость: composition root и команда импортируют типы из этого модуля.
export type { CoverConfig, CoverDeps, CoverOutcome, OnVacancy } from "@/application/cover/CoverDeps.js";

/**
 * Сопроводительные письма: с id — одно, без id — весь последний дайджест.
 * onVacancy — колбэк команды для печати заголовка вакансии (порядок вывода прежний).
 */
export async function runCover(
  vacancyId: string | undefined,
  opts: Record<string, any>,
  deps: CoverDeps,
  onVacancy?: OnVacancy,
): Promise<CoverOutcome> {
  return new CoverScenario(deps).run(vacancyId, opts, onVacancy);
}
