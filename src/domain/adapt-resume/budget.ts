// Бюджет адаптации резюме: дефолт и нижняя граница — одно правило для всех входов.
//
// Раньше кламп `Math.max(500, …)` повторялся в CoverSettings, DigestPolicy и самой
// адаптации; теперь значение приводится здесь, а вызывающие передают сырое число.
/** Сколько символов адаптированного резюме по умолчанию уходит в промпт. */
export const DEFAULT_ADAPT_BUDGET = 3500;

/** Ниже этого бюджет не опускается: иначе в промпт не попадёт даже шапка резюме. */
const MIN_ADAPT_BUDGET = 500;

/** Бюджет в символах: целое, не меньше MIN_ADAPT_BUDGET; пустое значение — дефолт. */
export function adaptBudget(value?: number): number {
  const parsed = Math.floor(Number(value));
  return Math.max(MIN_ADAPT_BUDGET, parsed || DEFAULT_ADAPT_BUDGET);
}
