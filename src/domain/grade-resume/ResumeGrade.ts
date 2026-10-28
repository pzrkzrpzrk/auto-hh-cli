// Оценка резюме (Value Object + Factory).
//
// Раньше ответ модели уходил в presentation как Record<string, any>: форма не проверялась,
// а отчёт падал на неожиданных типах (`forEach` по строке, деление на нечисловой max).
// Теперь инвариант «что считается оценкой» и терпимость к форме ответа модели живут здесь;
// транспорт (chat, ретраи, логи) — в application/grade/ResumeGradeService.

/** Максимальные баллы категорий: сумма = 100, веса заданы промптом. */
const CATEGORY_MAX = {
  firstImpression: 25,
  positioning: 25,
  redFlags: 20,
  contextAndScale: 20,
  shortlistReadiness: 10,
} as const;

type CategoryKey = keyof typeof CATEGORY_MAX;

/** Форма ответа модели: свободная, поля проверяет fromModel. */
type ModelPayload = Record<string, unknown>;

function payloadOf(raw: unknown): ModelPayload | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ModelPayload) : null;
}

/** Число из ответа модели: строки приводятся, нечисловое — 0, значения зажимаются в 0..max. */
function scoreOf(value: unknown, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(max, num));
}

/** Строка из ответа модели: null/undefined — пустая, остальное — как есть. */
function textOf(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value);
}

/** Список из ответа модели: не массив — пустой список. */
function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textOf) : [];
}

/** Балл одной категории: score в 0..max, max — из промпта, если модель его не повторила. */
export class CategoryScore {
  private constructor(
    readonly score: number,
    readonly max: number,
  ) {}

  static fromModel(raw: unknown, fallbackMax: number): CategoryScore {
    const payload = payloadOf(raw);
    const explicit = Number(payload?.max);
    // max = 0 или мусор сломали бы полоску отчёта (деление на ноль), поэтому берём вес промпта.
    const max = Number.isFinite(explicit) && explicit > 0 ? explicit : fallbackMax;
    return new CategoryScore(scoreOf(payload?.score, max), max);
  }
}

/** Один пункт детального разбора: status решает значок «Хорошо» / «Требует внимания». */
export class GradeDetail {
  private constructor(
    readonly category: string,
    readonly status: 'good' | 'attention',
    readonly description: string,
    readonly quotes: string[],
    readonly recommendations: string[],
  ) {}

  static fromModel(raw: unknown): GradeDetail {
    const payload = payloadOf(raw) ?? {};
    return new GradeDetail(
      textOf(payload.category),
      payload.status === 'good' ? 'good' : 'attention',
      textOf(payload.description),
      listOf(payload.quotes),
      listOf(payload.recommendations),
    );
  }
}

export class ResumeGrade {
  private constructor(
    /** Итоговый балл 0..100. */
    readonly overallScore: number,
    /** Текстовая оценка рекрутера (1–2 абзаца). */
    readonly overallAssessment: string,
    readonly strengths: string[],
    readonly weaknesses: string[],
    readonly missing: string[],
    readonly recommendations: string[],
    /** Пять взвешенных категорий: ключи и веса заданы промптом. */
    readonly categoryScores: Record<CategoryKey, CategoryScore>,
    readonly detailedAnalysis: GradeDetail[],
  ) {}

  /**
   * Разобрать ответ модели. null — ответ не объект (массив/строка/мусор):
   * вызывающий считает это ошибкой шага и логирует её.
   */
  static fromModel(raw: unknown): ResumeGrade | null {
    const payload = payloadOf(raw);
    if (!payload) return null;

    const scores = payloadOf(payload.categoryScores) ?? {};
    const keys = Object.keys(CATEGORY_MAX) as CategoryKey[];
    const categoryScores = Object.fromEntries(
      keys.map(key => [key, CategoryScore.fromModel(scores[key], CATEGORY_MAX[key])]),
    ) as Record<CategoryKey, CategoryScore>;

    const details = Array.isArray(payload.detailedAnalysis)
      ? payload.detailedAnalysis
          .filter(item => payloadOf(item) !== null)
          .map(item => GradeDetail.fromModel(item))
      : [];

    return new ResumeGrade(
      scoreOf(payload.overallScore, 100),
      textOf(payload.overallAssessment),
      listOf(payload.strengths),
      listOf(payload.weaknesses),
      listOf(payload.missing),
      listOf(payload.recommendations),
      categoryScores,
      details,
    );
  }
}
