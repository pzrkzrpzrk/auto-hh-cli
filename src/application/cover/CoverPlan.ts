// Value Object: счётчики прогона писем и их строки для лога.
// Раньше числа и тексты собирались выражениями прямо в coverDigest — теперь один объект
// отвечает и за арифметику, и за формулировку, поэтому логи не разъезжаются с цифрами.
export class CoverPlan {
  constructor(
    /** Сколько вакансий попало в план (после лимита). */
    readonly total: number,
    /** Сколько вакансий осталось без письма. */
    readonly pending: number,
  ) {}

  /** Письма уже есть — их не перегенерируем (force обнуляет это на входе). */
  get existing(): number {
    return this.total - this.pending;
  }

  /** Строка «Вакансий: N, письма уже есть: N, генерируем: N». */
  toString(): string {
    return `Вакансий: ${this.total}, письма уже есть: ${this.existing}, генерируем: ${this.pending}`;
  }
}

export class CoverProgress {
  constructor(
    /** Сколько записей дайджеста имеют письмо после генерации. */
    readonly ready: number,
    /** Сколько записей всего в дайджесте (не только в лимите). */
    readonly total: number,
  ) {}

  /** Есть что записывать в дайджест: письма обновляются только при готовых. */
  get hasReady(): boolean {
    return this.ready > 0;
  }

  /** Строка «Сопроводительных готово: N/N». */
  toString(): string {
    return `Сопроводительных готово: ${this.ready}/${this.total}`;
  }
}
