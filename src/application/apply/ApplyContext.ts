// Контекст прогона отклика: план, который стадии собирают по шагам.
// Один mutable-объект вместо десятка параметров между функциями прежнего runApply.
import type { DigestEntry } from "@/domain/models.js";
import type { ApplyDeps } from "@/application/apply/ApplyDeps.js";
import type { ApplySummary } from "@/application/apply/ApplySummary.js";
import type { DigestSelection } from "@/application/apply/DigestSelection.js";
import type { Pacing } from "@/application/apply/Pacing.js";
import type { SkipRule } from "@/application/apply/SkipRules.js";

export interface ApplyContext {
  readonly deps: ApplyDeps;
  /** Флаги команды: `type` превращается в стратегию, `limit` читает стадия лимита. */
  readonly opts: Record<string, any>;
  /** Стратегия выбора вакансий (latest/all). */
  readonly selection: DigestSelection;
  /** Голова цепочки правил пропуска. */
  readonly skipRules: SkipRule;
  /** Стратегия паузы между откликами. */
  readonly pacing: Pacing;
  /** Value Object со счётчиками прогона. */
  readonly summary: ApplySummary;

  /** Стадии заполняют по мере продвижения. */
  entries: DigestEntry[];
  planned: DigestEntry[];
  applied: Record<string, any>;
}
