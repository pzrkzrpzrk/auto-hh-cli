// Адаптер порта Scheduler: единственное место с node-cron.
import cron from "node-cron";
import type { Scheduler } from "@/domain/ports.js";

class NodeCronScheduler implements Scheduler {
  validate(expression: string): boolean {
    return cron.validate(expression);
  }

  schedule(expression: string, fn: () => void | Promise<void>): void {
    cron.schedule(expression, () => {
      void fn();
    });
  }
}

export default NodeCronScheduler;
