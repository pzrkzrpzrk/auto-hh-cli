// Сценарий оценки резюме: файлы и ИИ приходят портами из composition root.
// Домен получает готовое резюме параметром и не знает ни про диск, ни про RESUMES_DIR.
// Оркестрация — application/grade/ResumeGradeService, здесь только точка входа шага.
import { ResumeGradeService } from "@/application/grade/ResumeGradeService.js";
import type { GradeDeps } from "@/application/grade/GradeDeps.js";
import type { ResumeGrade } from "@/domain/grade-resume/ResumeGrade.js";

export type { GradeDeps } from "@/application/grade/GradeDeps.js";
// DTO для печати: presentation не импортирует domain напрямую (правило depcruise).
export type { ResumeGrade } from "@/domain/grade-resume/ResumeGrade.js";

/** Оценка резюме ИИ: загружает резюме (по имени или из .env) и передаёт его сервису. */
export async function gradeResumeFromFile(
  opts: { resume?: string } = {},
  deps: GradeDeps,
): Promise<ResumeGrade | null> {
  const ai = deps.ai();
  const service = new ResumeGradeService(ai, deps.logger);
  // Без ИИ резюме не нужно: сервис сам сообщит об отсутствии ключа (как и раньше),
  // а лишняя ошибка «резюме не найдено» не появится.
  if (!ai) return service.grade(null);
  return service.grade(deps.resumeFiles.load(opts.resume));
}
