// Хеш содержимого резюме: общая утилита без привязки к слоям.
// Реестр резюме хранит contentHash, чтобы отличать «то же имя файла» от «то же содержимое».
import crypto from "crypto";

/** sha256 в hex. */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Отпечаток содержимого резюме: текст для .md/.txt, base64 для PDF.
 * Именно это содержимое уходит в ИИ, поэтому изменение отпечатка = устаревшие вердикты/письма.
 */
export function resumeContentHash(resume: { type: 'text' | 'pdf'; text?: string; data?: string }): string {
  return sha256(resume.type === 'pdf' ? (resume.data || '') : (resume.text || ''));
}
