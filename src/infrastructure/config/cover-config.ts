// Адаптер настроек писем: config.json и переменные окружения читаются здесь,
// а дефолты и границы — в доменном CoverSettings (он же Value Object).
import { configProvider } from "@/infrastructure/config/config.js";
import { intFromEnv } from "@/infrastructure/config/env.js";
import { CoverSettings } from "@/domain/cover-letter/config.js";

/** Настройки писем: шаблон и бюджет из config.json, пачка/параллелизм/профиль — из env. */
export function coverConfig(path?: string): CoverSettings {
  const cfg = configProvider.load(path);
  return CoverSettings.from({
    coverLetterTemplate: cfg.apply?.coverLetterTemplate,
    adaptResume: cfg.adaptResume !== false,
    adaptResumeBudget: cfg.adaptResumeBudget,
    batchSize: intFromEnv('COVER_BATCH_SIZE', CoverSettings.DEFAULT_BATCH_SIZE, { min: 1 }),
    profile: process.env.APPLICANT_PROFILE,
    signature: process.env.COVER_SIGNATURE,
    concurrency: intFromEnv('AI_CONCURRENCY', CoverSettings.DEFAULT_CONCURRENCY, { min: 1 }),
  });
}

export default coverConfig;

