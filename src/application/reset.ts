// Сброс истории, кэша и дайджестов: сценарий поверх порта DataJanitor.
// Раскладку data/ и имена Mongo-коллекций знает адаптер (data-janitor).
import type { DataJanitor, ResetSummary } from "@/domain/ports.js";

export type { ResetSummary } from "@/domain/ports.js";

export interface ResetDeps {
  janitor: DataJanitor;
}

/** Строка-сводка для консоли: «history 1278, digest 7, cachePages 65». */
export function formatResetSummary(s: ResetSummary): string {
  return [
    ...s.mongo.filter(m => m.deleted).map(m => `${m.collection} ${m.deleted}`),
    ...s.cache,
  ].join(', ');
}

export default async function resetData(deps: ResetDeps): Promise<ResetSummary> {
  return deps.janitor.clearAll();
}
