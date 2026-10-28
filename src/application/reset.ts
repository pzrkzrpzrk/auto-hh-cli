// Сброс истории, кэша и дайджестов: сценарий поверх порта DataJanitor.
// Раскладку data/ и имена таблиц БД знает адаптер (infrastructure/janitor.ts).
import type { DataJanitor, ResetSummary, ResumeProvider } from "@/domain/ports.js";
import type { Resume, ResumeRef } from "@/domain/models.js";

export type { ResetSummary } from "@/domain/ports.js";

export interface ResetDeps {
  janitor: DataJanitor;
  /** Резюме из опции `resume`: нужно для точечного сброса. */
  resumeFiles: ResumeProvider;
}

/** Итог сброса: ok + что почистили, либо имя резюме, которого нет. */
export type ResetOutcome =
  | { kind: 'not-found'; name: string }
  | { kind: 'ok'; resume: ResumeRef | null; summary: ResetSummary };

/** Строка-сводка для консоли: «history 1278, digest 7, cachePages 65». */
export function formatResetSummary(s: ResetSummary): string {
  return [
    ...s.db.filter(t => t.deleted).map(t => `${t.table} ${t.deleted}`),
    ...s.cache,
  ].join(', ');
}

/** opts.resume — сбросить только это резюме; без него — всё, как раньше. */
export default async function resetData(
  deps: ResetDeps,
  opts: { resume?: string } = {},
): Promise<ResetOutcome> {
  if (!opts.resume) {
    return { kind: 'ok', resume: null, summary: await deps.janitor.clearAll() };
  }

  let resume: Resume | null;
  try {
    resume = deps.resumeFiles.load(opts.resume);
  } catch {
    resume = null;
  }
  if (!resume) return { kind: 'not-found', name: opts.resume };

  const ref: ResumeRef = { name: resume.name, id: resume.id };
  return { kind: 'ok', resume: ref, summary: await deps.janitor.clearResume(ref) };
}
