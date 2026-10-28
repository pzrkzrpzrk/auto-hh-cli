// Адаптер порта Scheduler: единственное место с node-cron.
// Расчёт «следующего запуска» тоже здесь: разбирать cron-выражение вручную не нужно.
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import type { Scheduler } from "@/domain/ports.js";

class NodeCronScheduler implements Scheduler {
  private scheduled: { expression: string; task: ScheduledTask } | null = null;

  validate(expression: string): boolean {
    return cron.validate(expression);
  }

  schedule(expression: string, fn: () => void | Promise<void>): void {
    // Повторная постановка не должна оставлять работающую «старую» задачу.
    if (this.scheduled) void this.scheduled.task.stop();
    const task = cron.schedule(expression, () => {
      void fn();
    });
    this.scheduled = { expression, task };
  }

  nextRun(expression: string): Date | null {
    // Для уже стоящей задачи берём её расчёт; для проверки выражения — временную,
    // которую сразу останавливаем, чтобы она не висела в планировщике.
    if (this.scheduled?.expression === expression) {
      return this.scheduled.task.getNextRun() ?? null;
    }
    const probe = cron.schedule(expression, () => {});
    try {
      return probe.getNextRun() ?? null;
    } finally {
      void probe.stop();
    }
  }
}

export default NodeCronScheduler;

