// Стратегия выбора вакансий для отклика: сегодняшний дайджест или все сохранённые.
// Заменяет ветку `if (type === 'all')` внутри сценария: у каждого режима свой класс,
// а новый источник (например, дайджест за дату) добавляется ещё одной реализацией.
import type { DigestEntry } from "@/domain/models.js";
import type { DigestRepository } from "@/domain/digest/ports.js";
import { dateKey } from "@/shared/time.js";

export interface DigestSelection {
  /** Режим из флага `type` — нужен сценарию только для лога. */
  readonly kind: 'latest' | 'all';
  load(digests: DigestRepository): Promise<DigestEntry[]>;
}

/** latest (по умолчанию): только сегодняшний дайджест. */
export class LatestDigestSelection implements DigestSelection {
  readonly kind = 'latest' as const;

  load(digests: DigestRepository): Promise<DigestEntry[]> {
    return digests.byDate(dateKey());
  }
}

/** all: все сохранённые дайджесты без отклика (режим apply --type all). */
export class AllDigestsSelection implements DigestSelection {
  readonly kind = 'all' as const;

  load(digests: DigestRepository): Promise<DigestEntry[]> {
    return digests.all();
  }
}

/** Флаг команды `type` → стратегия; неизвестное значение ведёт себя как latest. */
export function digestSelection(type: string): DigestSelection {
  return type === 'all' ? new AllDigestsSelection() : new LatestDigestSelection();
}
