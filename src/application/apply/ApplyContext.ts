// Контекст прогона отклика: план, который стадии собирают по шагам.
// Один mutable-объект вместо десятка параметров между функциями прежнего runApply.
import type { DigestEntry } from "../../domain/models.js";
import type { ApplyDeps } from "./ApplyDeps.js";
import type { ApplySummary } from "./ApplySummary.js";
import type { DigestSelection } from "./DigestSelection.js";
import type { Pacing } from "./Pacing.js";
import type { SkipRule } from "./SkipRules.js";

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
