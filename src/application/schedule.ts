// Сценарий планировщика: запуск пайплайна (search → digest → cover) по cron-расписанию.
// Сами шаги приходят из presentation (application не зависит от команд), печать — тоже там.
import { getNextDate } from "@/shared/cron.js";
import log from "@/shared/logger.js";
import type { ConfigProvider, Scheduler } from "@/domain/ports.js";

export type PipelineStep = (opts?: Record<string, any>) => Promise<any>;

export interface ScheduleRuntimeDeps {
  /** Конфиг читается по явному пути из opts.config; сценарий не трогает env. */
  config: ConfigProvider;
  /** Планировщик: адаптер подставляет composition root. */
  scheduler: Scheduler;
}

export interface ScheduleDeps extends ScheduleRuntimeDeps {
  /** Шаги пайплайна по именам из config.schedule.steps. */
  steps: Record<string, PipelineStep>;
}

/** Шаги по умолчанию, если config.schedule.steps не задан. */
export const DEFAULT_STEPS = ["search", "digest", "cover"];

export function resolveSteps(cfg: any): string[] {
  const steps = cfg.schedule?.steps;
  if (!Array.isArray(steps) || !steps.length) return DEFAULT_STEPS;
  return steps.map(s => String(s).toLowerCase());
}

/** События для печати: команда выводит их в том же порядке, что и раньше. */
export type ScheduleEvent =
  | { type: 'pipeline-start'; at: string }
  | { type: 'step-completed'; step: string; at: string }
  | { type: 'step-failed'; step: string; message: string }
  | { type: 'next-run'; at: Date };

/** Итог постановки расписания: команда печатает шапку и выставляет код возврата. */
export type ScheduleOutcome =
  | { kind: 'no-cron' }
  | { kind: 'invalid-cron'; expression: string }
  | { kind: 'scheduled'; expression: string; steps: string[]; resume: string | null; next: Date | null };

export async function runSchedule(
  opts: Record<string, any> = {},
  deps: ScheduleDeps,
  report?: (event: ScheduleEvent) => void,
): Promise<ScheduleOutcome> {
  const cfg = deps.config.load(opts.config);
  // Резюме из меню ui (если выбрано) — иначе шаги digest/cover возьмут дефолт из .env.
  // Путь к конфигу передаём шагам, чтобы альтернативный файл действовал на весь прогон.
  const stepOpts: Record<string, any> = {
    ...(opts.resume ? { resume: opts.resume } : {}),
    ...(opts.config ? { config: opts.config } : {}),
  };

  if (!cfg.schedule?.cron) {
    return { kind: 'no-cron' };
  }

  const expression = cfg.schedule.cron;
  const steps = resolveSteps(cfg);

  if (!deps.scheduler.validate(expression)) {
    return { kind: 'invalid-cron', expression };
  }

  const next = getNextDate(expression);

  deps.scheduler.schedule(expression, async () => {
    report?.({ type: 'pipeline-start', at: new Date().toISOString() });

    for (const step of steps) {
      const run = deps.steps[step];
      if (!run) {
        log.warn(`Unknown schedule step "${step}" — пропускаю`);
        continue;
      }
      log.info(`Scheduled step started: ${step}`);
      try {
        await run(stepOpts);
        log.info(`Scheduled step completed: ${step}`);
        report?.({ type: 'step-completed', step, at: new Date().toISOString() });
      } catch (err: any) {
        log.error(`Scheduled step "${step}" failed: ${err.message}`);
        report?.({ type: 'step-failed', step, message: err.message });
        break;
      }
    }

    const next2 = getNextDate(expression);
    if (next2) report?.({ type: 'next-run', at: next2 });
  });

  return { kind: 'scheduled', expression, steps, resume: opts.resume ?? null, next };
}
