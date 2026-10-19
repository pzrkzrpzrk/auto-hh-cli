// Сценарий оценки резюме: файлы и ИИ приходят портами из composition root.
// Домен получает готовое резюме параметром и не знает ни про диск, ни про RESUMES_DIR.
import { gradeResume } from "../domain/grade-resume.js";
import type { AiProvider, ResumeFiles } from "../domain/ports.js";
import type { Logger } from "../domain/logging.js";

/** Зависимости оценки: ленивый ИИ и файлы резюме. */
export interface GradeDeps {
  ai: (path?: string) => AiProvider | null;
  resumeFiles: ResumeFiles;
  logger?: Logger;
}

/** Оценка резюме ИИ: загружает резюме (по имени или из .env) и передаёт его домену. */
export async function gradeResumeFromFile(
  opts: { resume?: string } = {},
  deps: GradeDeps,
) {
  const ai = deps.ai();
  // Без ИИ резюме не нужно: домен сам сообщит об отсутствии ключа (как и раньше),
  // а лишняя ошибка «резюме не найдено» не появится.
  if (!ai) return gradeResume(ai, null, deps.logger);
  return gradeResume(ai, deps.resumeFiles.load(opts.resume), deps.logger);
}

