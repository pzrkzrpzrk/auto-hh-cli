// Настройки сопроводительных писем — контракт «какие правила нужны для письма».
// Живёт в домене: composition root наполняет его адаптером
// infrastructure/config/cover-config.ts, а сценарий только использует и не знает
// ни про env, ни про файл конфигурации.
export interface CoverConfig {
  coverLetterTemplate?: string;
  /** Адаптировать резюме под каждую вакансию (config.adaptResume !== false). */
  adaptResume: boolean;
  /** Лимит символов на адаптированное резюме (config.adaptResumeBudget). */
  adaptResumeBudget: number;
  /** Сколько вакансий уходит в один запрос к ИИ (COVER_BATCH_SIZE). */
  batchSize: number;
  /** Профиль соискателя (APPLICANT_PROFILE). */
  profile: string;
  /** Подпись письма (COVER_SIGNATURE, иначе плейсхолдер). */
  signature: string;
  /** Параллелизм пачек писем (AI_CONCURRENCY). */
  concurrency: number;
}
