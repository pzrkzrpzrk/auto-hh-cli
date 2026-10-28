// Вердикт судьи (Value Object + Factory).
//
// Раньше normalizeVerdict/verdictList были приватными функциями judge.ts и жили вплотную
// к вызовам ИИ. Теперь инвариант вердикта и терпимость к форме ответа модели — в неизменяемом
// объекте: транспорт (chat, ретраи, логи) остался в application/judge/JudgeService.
//
// Инвариант: fit=true ⇒ comment непустой и reason=null;
//            fit=false ⇒ reason непустой и comment=null.
import type { Judgement } from "@/domain/digest/JudgementSet.js";

/** Одна запись ответа модели: форма вольная — поля проверяет fromModel. */
type ModelPayload = Record<string, unknown>;

export class Verdict {
  private constructor(
    /** id вакансии из ответа модели — ключ Map в батчевом режиме. */
    readonly vacancyId: string,
    /** Прошла ли вакансия порог отклика. */
    readonly fit: boolean,
    /** Оценка 1–10 (значения вне диапазона поднимаются/опускаются до границ). */
    readonly score: number,
    /** Почему не подошла: заполняется только при fit=false. */
    readonly reason: string | null,
    /** Что совпало: заполняется только при fit=true. */
    readonly comment: string | null,
  ) {}

  /**
   * Разобрать одну запись ответа модели и привести её к инварианту.
   * Битые поля не бросают исключение: score зажимается, строки тримятся,
   * отсутствующие reason/comment заполняются шаблонной фразой.
   */
  static fromModel(raw: unknown): Verdict {
    const payload: ModelPayload = raw && typeof raw === 'object' ? raw as ModelPayload : {};
    const score = Math.max(1, Math.min(10, Number(payload.score) || 1));
    const fit = payload.fit === true;
    const reasonRaw = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    const commentRaw = typeof payload.comment === 'string' ? payload.comment.trim() : '';

    let reason: string | null = null;
    let comment: string | null = null;
    if (fit) {
      comment = commentRaw || reasonRaw || `Соответствие профилю (score ${score}/10)`;
    } else {
      reason = reasonRaw || commentRaw || `Совпадение слабое (score ${score}/10)`;
    }

    return new Verdict(String(payload.vacancyId ?? ''), fit, score, reason, comment);
  }

  /**
   * Разобрать ответ модели целиком: принимаются и голый массив (GLM), и
   * объект {"verdicts": [...]}. Не-объекты в массиве пропускаются.
   */
  static listFromModel(payload: unknown): Verdict[] {
    const container = payload as { verdicts?: unknown } | null;
    const list: unknown = Array.isArray(payload)
      ? payload
      : Array.isArray(container?.verdicts)
        ? container?.verdicts
        : [];
    return (list as unknown[])
      .filter(item => Boolean(item) && typeof item === 'object')
      .map(item => Verdict.fromModel(item));
  }

  /** Вердикт в форме кэша cacheJudgements — без vacancyId (он стал ключом записи). */
  toJudgement(): Judgement {
    return {
      score: this.score,
      fit: this.fit,
      reason: this.reason,
      comment: this.comment,
    };
  }
}
