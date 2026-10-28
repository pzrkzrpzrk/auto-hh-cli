// Политика настроек писем: config.json и переменные окружения читаются здесь,
// а не в composition root (он только связывает функцию с портом) и не в сценарии.
// Дефолты бюджета и подписи — доменные: тот же дефолт использует DigestPolicy.
import { configProvider } from "@/infrastructure/config/config.js";
import { intFromEnv } from "@/infrastructure/config/env.js";
import { DEFAULT_ADAPT_BUDGET } from "@/domain/adapt-resume.js";
import { DEFAULT_COVER_SIGNATURE } from "@/domain/cover-letter/system-text.js";
import type { CoverConfig } from "@/domain/cover-letter/config.js";

/** Настройки писем: шаблон и бюджет из config.json, пачка/параллелизм/профиль — из env. */
export function coverConfig(path?: string): CoverConfig {
  const cfg = configProvider.load(path);
  return {
    coverLetterTemplate: cfg.apply?.coverLetterTemplate,
    adaptResume: cfg.adaptResume !== false,
    adaptResumeBudget: Math.max(500, Math.floor(Number(cfg.adaptResumeBudget)) || DEFAULT_ADAPT_BUDGET),
    batchSize: intFromEnv('COVER_BATCH_SIZE', 20, { min: 1 }),
    profile: process.env.APPLICANT_PROFILE || 'опытный разработчик',
    signature: process.env.COVER_SIGNATURE || DEFAULT_COVER_SIGNATURE,
    concurrency: intFromEnv('AI_CONCURRENCY', 10, { min: 1 }),
  };
}

export default coverConfig;
