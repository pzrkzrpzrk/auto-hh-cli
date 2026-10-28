// Настройки сопроводительных писем (Value Object).
//
// Раньше это был интерфейс-мешок: дефолты жили в cover-config.ts и в самом домене,
// а сценарий принимал ещё один необязательный набор полей (CoverLetterOptions).
// Теперь один неизменяемый объект: дефолты и клампы — здесь, env читает адаптер.
import { DEFAULT_ADAPT_BUDGET } from "@/domain/adapt-resume.js";
import { CoverSignature } from "@/domain/cover-letter/CoverSignature.js";

/** Сырые настройки: config.json и env передаёт адаптер, значения необязательны. */
export interface CoverSettingsInput {
  coverLetterTemplate?: string;
  /** Адаптировать резюме под каждую вакансию (config.adaptResume !== false). */
  adaptResume?: boolean;
  /** Лимит символов на адаптированное резюме (config.adaptResumeBudget). */
  adaptResumeBudget?: number;
  /** Сколько вакансий уходит в один запрос к ИИ (COVER_BATCH_SIZE). */
  batchSize?: number;
  /** Профиль соискателя (APPLICANT_PROFILE). */
  profile?: string;
  /** Подпись письма (COVER_SIGNATURE, иначе плейсхолдер). */
  signature?: string;
  /** Параллелизм пачек писем (AI_CONCURRENCY). */
  concurrency?: number;
}

/** Положительное целое или дефолт: 0/NaN/отрицательное не проходят. */
function positive(value: number | undefined, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class CoverSettings {
  static readonly DEFAULT_PROFILE = 'опытный разработчик';
  static readonly DEFAULT_BATCH_SIZE = 20;
  static readonly DEFAULT_CONCURRENCY = 10;
  /** Минимальный бюджет адаптации резюме — как в DigestPolicy. */
  static readonly MIN_ADAPT_BUDGET = 500;

  private constructor(
    readonly coverLetterTemplate: string | undefined,
    readonly adaptResume: boolean,
    readonly adaptResumeBudget: number,
    readonly batchSize: number,
    readonly profile: string,
    readonly signature: CoverSignature,
    readonly concurrency: number,
  ) {}

  /** Собрать настройки из config.json/env: дефолты и границы применяются один раз. */
  static from(input: CoverSettingsInput = {}): CoverSettings {
    return new CoverSettings(
      input.coverLetterTemplate,
      input.adaptResume !== false,
      Math.max(
        CoverSettings.MIN_ADAPT_BUDGET,
        Math.floor(Number(input.adaptResumeBudget)) || DEFAULT_ADAPT_BUDGET,
      ),
      positive(input.batchSize, CoverSettings.DEFAULT_BATCH_SIZE),
      input.profile || CoverSettings.DEFAULT_PROFILE,
      new CoverSignature(input.signature),
      positive(input.concurrency, CoverSettings.DEFAULT_CONCURRENCY),
    );
  }

  /** Шаблон задан — при отказе ИИ письмо соберётся по нему. */
  get hasTemplate(): boolean {
    return Boolean(this.coverLetterTemplate);
  }
}

/** Совместимое имя: сценарии и порты говорят CoverConfig, значение — CoverSettings. */
export type CoverConfig = CoverSettings;

