// Набор вердиктов ИИ-судьи (Value Object).
// Заменяет сырой `Map`, который сценарий собирал из cache.judgements и мутировал вручную:
// теперь у набора явные операции — pending(), merge(), toSnapshot().
import type { DigestCandidate } from "./DigestCandidate.js";

/** Вердикт судьи в том виде, в каком он лежит в cacheJudgements. */
export interface Judgement {
  score: number;
  fit: boolean;
  reason: string | null;
  comment: string | null;
}

export class JudgementSet {
  private readonly byId = new Map<string, Judgement>();

  private constructor(snapshot: Record<string, any>) {
    for (const [id, judgement] of Object.entries(snapshot || {})) {
      if (judgement) this.byId.set(String(id), judgement as Judgement);
    }
  }

  /** Собрать набор из снапшота cacheJudgements (ключ — id вакансии). */
  static fromSnapshot(snapshot: Record<string, any> = {}): JudgementSet {
    return new JudgementSet(snapshot);
  }

  get size(): number {
    return this.byId.size;
  }

  has(id: string | number): boolean {
    return this.byId.has(String(id));
  }

  get(id: string | number): Judgement | null {
    return this.byId.get(String(id)) ?? null;
  }

  /** Добавить вердикты из ответа судьи (пачкой или поштучно). */
  merge(judgements: Map<string, Judgement>): void {
    for (const [id, judgement] of judgements.entries()) {
      this.byId.set(String(id), judgement);
    }
  }

  /** Кандидаты, для которых вердикта ещё нет (их и отдаём судье). */
  pending(candidates: DigestCandidate[]): DigestCandidate[] {
    return candidates.filter(candidate => !this.has(candidate.full.id));
  }

  /** Снапшот для сохранения в cacheJudgements в прежнем формате. */
  toSnapshot(): Record<string, Judgement> {
    return Object.fromEntries(this.byId.entries());
  }
}
