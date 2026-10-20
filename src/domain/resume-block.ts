// Блок резюме для промпта модели. Чистое форматирование — не зависит от SDK,
// поэтому живёт в домене, а не в клиенте ИИ.
import type { Resume } from "@/domain/models.js";

/**
 * Блок резюме соискателя для сообщения модели.
 * adaptedText — резюме, подогнанное под конкретную вакансию (тогда берётся оно).
 */
export function buildResumeBlock(
  resume: Resume | null,
  adaptedText: string | null = null,
): { type: string; text: string } | null {
  if (!resume) return null;
  if (adaptedText) {
    return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ (адаптированное под вакансию) ===\n${adaptedText}` };
  }
  if (resume.type === 'pdf') {
    return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ (PDF) ===\n${resume.filename}` };
  }
  return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ ===\n${resume.text}` };
}
