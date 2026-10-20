// Цепочка правил пропуска (Chain of Responsibility): почему вакансию не берём в отклик.
// Раньше это были два if подряд в цикле; теперь правило — отдельный класс, и новое
// условие (стоп-слово, лимит по компании) добавляется звеном цепочки.
import type { DigestEntry } from "@/domain/models.js";

/** Решение правила: что писать в лог и считать ли пропуск в сводке. */
export interface SkipDecision {
  /** Уровень лога: нет письма — предупреждение, повторный отклик — информация. */
  readonly level: 'warn' | 'info';
  /** Текст сообщения — тот же, что был в сценарии. */
  readonly message: string;
  /** Считать ли пропуск в сводке skipped (без письма — да, уже откликались — нет). */
  readonly counted: boolean;
}

/**
 * Звено цепочки (Template Method): `check` идёт по звеньям, `evaluate` описывает
 * конкретное правило. null — правило не сработало, спрашиваем следующее.
 */
export abstract class SkipRule {
  private next: SkipRule | null = null;

  /** Связать правила в цепочку; возвращает это звено, поэтому вызовы можно писать подряд. */
  setNext(rule: SkipRule): SkipRule {
    this.next = rule;
    return this;
  }

  check(entry: DigestEntry, applied: Record<string, any>): SkipDecision | null {
    return this.evaluate(entry, applied) ?? this.next?.check(entry, applied) ?? null;
  }

  protected abstract evaluate(entry: DigestEntry, applied: Record<string, any>): SkipDecision | null;
}

/** Правило 1: письмо не сгенерировано (шаг cover пропущен) — вакансию не трогаем. */
export class MissingLetterRule extends SkipRule {
  protected evaluate(entry: DigestEntry): SkipDecision | null {
    if (entry.coverLetter) return null;
    return { level: 'warn', message: `Skip ${entry.id}: no cover letter`, counted: true };
  }
}

/** Правило 2: настоящий отклик уже был; digest-only отметка (`digestOnly`) не считается. */
export class AlreadyAppliedRule extends SkipRule {
  protected evaluate(entry: DigestEntry, applied: Record<string, any>): SkipDecision | null {
    const record = applied[entry.id];
    if (!record || record.digestOnly) return null;
    return { level: 'info', message: `Skip ${entry.id}: already applied`, counted: false };
  }
}

/** Боевая цепочка: сначала «нет письма», затем «уже откликались» — порядок важен для лога. */
export function applySkipRules(): SkipRule {
  return new MissingLetterRule().setNext(new AlreadyAppliedRule());
}
