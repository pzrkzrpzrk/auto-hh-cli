// Сценарий оценки резюме: чтение файла (I/O) — здесь, доменное правило — в domain/grade-resume.ts.
// Домен получает готовое резюме параметром и не знает ни про диск, ни про RESUMES_DIR.
import { loadResume } from "../infrastructure/files/resume-loader.js";
import { gradeResume } from "../domain/grade-resume.js";
import type { AiProvider } from "../domain/ports.js";

/** Оценка резюме ИИ: загружает резюме (по имени или из .env) и передаёт его домену. */
export async function gradeResumeFromFile(ai: AiProvider | null, opts: { resume?: string } = {}) {
  // Без ИИ резюме не нужно: домен сам сообщит об отсутствии ключа (как и раньше),
  // а лишняя ошибка «резюме не найдено» не появится.
  if (!ai) return gradeResume(ai, null);
  return gradeResume(ai, loadResume(opts.resume));
}
