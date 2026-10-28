// Публичная поверхность доменного модуля писем: подпись, шаблон, промпт и настройки.
export { CoverSignature, DEFAULT_COVER_SIGNATURE } from "@/domain/cover-letter/CoverSignature.js";
export { CoverTemplate } from "@/domain/cover-letter/CoverTemplate.js";
export { CoverLetterPrompt } from "@/domain/cover-letter/CoverLetterPrompt.js";
export { CoverSettings } from "@/domain/cover-letter/config.js";
export type { CoverConfig, CoverSettingsInput } from "@/domain/cover-letter/config.js";

