// Зависимости оценки резюме — только порты: composition root подставляет файлы и ИИ.
import type { Logger } from "@/domain/logging.js";
import type { AiProvider, ResumeFiles } from "@/domain/ports.js";

/** Ленивый ИИ (создаётся, когда шаг действительно запущен) и файлы резюме. */
export interface GradeDeps {
  ai: (path?: string) => AiProvider | null;
  resumeFiles: ResumeFiles;
  logger?: Logger;
}
