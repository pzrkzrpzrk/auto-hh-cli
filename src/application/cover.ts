// Сценарий сопроводительных писем: точка входа для команды и обратная совместимость runCover().
// Вся оркестрация — CoverScenario (фасад) + режимы и конвейер стадий в application/cover/.
import { CoverScenario } from "@/application/cover/CoverScenario.js";
import type { CoverDeps, CoverOutcome, OnVacancy } from "@/application/cover/CoverDeps.js";
import type { CoverOptions } from "@/application/options.js";

// Совместимость: composition root и команда импортируют типы из этого модуля.
export type { CoverConfig, CoverDeps, CoverOutcome, OnVacancy } from "@/application/cover/CoverDeps.js";
// DTO для печати: presentation не импортирует domain напрямую (правило depcruise).
export type { Vacancy } from "@/domain/models.js";

/**
 * Сопроводительные письма: с id — одно, без id — весь последний дайджест.
 * onVacancy — колбэк команды для печати заголовка вакансии (порядок вывода прежний).
 */
export async function runCover(
  vacancyId: string | undefined,
  opts: CoverOptions,
  deps: CoverDeps,
  onVacancy?: OnVacancy,
): Promise<CoverOutcome> {
  return new CoverScenario(deps).run(vacancyId, opts, onVacancy);
}
