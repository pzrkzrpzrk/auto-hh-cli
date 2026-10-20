// Value Object: счётчики прогона отклика и их представление.
// Раньше ok/fail/skipped были тремя let-переменными внутри цикла — теперь один объект,
// который умеет и считать, и отдать готовый итог команде.
import type { ApplyOutcome } from "@/application/apply/ApplyDeps.js";

export class ApplySummary {
  private okCount = 0;
  private failCount = 0;
  private skippedCount = 0;

  /** Отклик прошёл и отмечен в истории. */
  markApplied(): void {
    this.okCount++;
  }

  /** Отклик не прошёл (сессия вернула ok=false или упало исключение). */
  markFailed(): void {
    this.failCount++;
  }

  /** Вакансия пропущена по правилу, которое считается в сводке (нет письма). */
  markSkipped(): void {
    this.skippedCount++;
  }

  get ok(): number {
    return this.okCount;
  }

  get fail(): number {
    return this.failCount;
  }

  get skipped(): number {
    return this.skippedCount;
  }

  /** Итог для команды: тот же kind, что возвращал прежний runApply. */
  toOutcome(): ApplyOutcome {
    return { kind: 'done', ok: this.okCount, fail: this.failCount, skipped: this.skippedCount };
  }

  /** Строка сводки в логе: ровно `ok=N, fail=N, skipped=N`. */
  toString(): string {
    return `ok=${this.okCount}, fail=${this.failCount}, skipped=${this.skippedCount}`;
  }
}
