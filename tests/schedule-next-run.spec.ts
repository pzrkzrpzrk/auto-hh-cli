// Сценарий планировщика: «следующий запуск» приходит из порта Scheduler,
// а не из собственного разбора cron. Проверяем на фейковом планировщике.
import { describe, expect, it } from "vitest";
import { DEFAULT_STEPS, runSchedule } from "@/application/schedule";
import type { PipelineStep, ScheduleEvent } from "@/application/schedule";
import type { AppConfig, ConfigProvider, Scheduler } from "@/domain/ports";

class FakeScheduler implements Scheduler {
  scheduled: { expression: string; fn: () => void | Promise<void> } | null = null;
  nextRunCalls: string[] = [];

  constructor(
    private readonly next: Date | null = new Date('2026-10-28T12:00:00.000Z'),
    private readonly valid = true,
  ) {}

  validate(): boolean {
    return this.valid;
  }

  schedule(expression: string, fn: () => void | Promise<void>): void {
    this.scheduled = { expression, fn };
  }

  nextRun(expression: string): Date | null {
    this.nextRunCalls.push(expression);
    return this.next;
  }
}

function configProvider(config: AppConfig): ConfigProvider {
  return { load: () => config };
}

const steps: Record<string, PipelineStep> = {
  search: async () => {},
  digest: async () => {},
  cover: async () => {},
};

describe("runSchedule", () => {
  it("берёт следующий запуск из планировщика и ставит задачу", async () => {
    const scheduler = new FakeScheduler();
    const outcome = await runSchedule(
      {},
      { config: configProvider({ schedule: { cron: '*/5 * * * *' } }), scheduler, steps },
    );

    expect(outcome).toMatchObject({
      kind: 'scheduled',
      expression: '*/5 * * * *',
      steps: DEFAULT_STEPS,
      next: new Date('2026-10-28T12:00:00.000Z'),
    });
    expect(scheduler.scheduled?.expression).toBe('*/5 * * * *');
    // Один расчёт на постановку расписания — прежде их было два.
    expect(scheduler.nextRunCalls).toEqual(['*/5 * * * *']);
  });

  it("null от планировщика не ломает запуск — CLI покажет «неизвестно»", async () => {
    const scheduler = new FakeScheduler(null);
    const outcome = await runSchedule(
      {},
      { config: configProvider({ schedule: { cron: '0 9 * * *' } }), scheduler, steps },
    );

    expect(outcome).toMatchObject({ kind: 'scheduled', next: null });
  });

  it("без schedule.cron не ставит задачу", async () => {
    const scheduler = new FakeScheduler();
    const outcome = await runSchedule({}, { config: configProvider({}), scheduler, steps });

    expect(outcome).toEqual({ kind: 'no-cron' });
    expect(scheduler.scheduled).toBeNull();
    expect(scheduler.nextRunCalls).toEqual([]);
  });

  it("невалидное выражение не доходит до планировщика", async () => {
    const scheduler = new FakeScheduler(null, false);
    const outcome = await runSchedule(
      {},
      { config: configProvider({ schedule: { cron: 'не cron' } }), scheduler, steps },
    );

    expect(outcome).toEqual({ kind: 'invalid-cron', expression: 'не cron' });
    expect(scheduler.scheduled).toBeNull();
  });

  it("по срабатыванию проходит шаги и печатает следующий запуск из порта", async () => {
    const scheduler = new FakeScheduler();
    const events: ScheduleEvent[] = [];
    const config: AppConfig = { schedule: { cron: '*/5 * * * *', steps: ['search', 'cover'] } };

    await runSchedule({}, { config: configProvider(config), scheduler, steps }, event => events.push(event));
    await scheduler.scheduled?.fn();

    expect(events.map(event => event.type)).toEqual(['pipeline-start', 'step-completed', 'step-completed', 'next-run']);
    expect(events.filter(event => event.type === 'step-completed')).toMatchObject([
      { step: 'search' },
      { step: 'cover' },
    ]);
    expect(events.at(-1)).toEqual({ type: 'next-run', at: new Date('2026-10-28T12:00:00.000Z') });
    // Постановка + расчёт внутри срабатывания.
    expect(scheduler.nextRunCalls).toHaveLength(2);
  });
});
