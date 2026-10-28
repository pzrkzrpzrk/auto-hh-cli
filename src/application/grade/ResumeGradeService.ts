// Application Service оценки резюме: вызов ИИ, разбор ответа и диагностика.
//
// Домен (domain/grade-resume) остаётся чистым: GradePrompt отвечает за тексты промпта,
// ResumeGrade — за инвариант оценки. Здесь только use case: собрать сообщения, вызвать
// порт, поймать ошибку и залогировать теми же строками, что были в прежнем
// domain/grade-resume.ts (они попадают в лог-файл, тексты — инвариант).
import { GradePrompt } from "@/domain/grade-resume/GradePrompt.js";
import { ResumeGrade } from "@/domain/grade-resume/ResumeGrade.js";
import type { Logger } from "@/domain/logging.js";
import type { Resume } from "@/domain/models.js";
import type { AiMessage, AiProvider } from "@/domain/ports.js";
import { errorMessage } from "@/shared/errors.js";
import { parseJSON } from "@/shared/text-utils.js";

export class ResumeGradeService {
  /** ai=null — ключа нет: штатный режим без оценки, метод возвращает null. */
  constructor(
    private readonly ai: AiProvider | null,
    private readonly logger?: Logger,
  ) {}

  /** Оценка резюме или null (нет ключа/резюме, пустой ответ, ошибка модели). */
  async grade(resume: Resume | null): Promise<ResumeGrade | null> {
    const ai = this.ai;
    if (!ai) {
      this.logger?.warn("gradeResume: no API client (check API key)");
      return null;
    }

    if (!resume) {
      this.logger?.warn("gradeResume: resume not found (set RESUME_PATH)");
      return null;
    }

    const prompt = new GradePrompt();
    const messages: AiMessage[] = [
      { role: 'system', content: prompt.system() },
      { role: 'user', content: prompt.user(resume) },
    ];

    try {
      const resp = await ai.chat({ messages, json: true, label: 'оценка резюме' });
      const text = resp.text;
      if (!text) {
        this.logger?.warn("gradeResume: empty response");
        return null;
      }

      const grade = ResumeGrade.fromModel(parseJSON(text));
      if (!grade) {
        this.logger?.warn("gradeResume: unexpected response shape");
        return null;
      }

      this.logger?.debug(
        `gradeResume: score=${grade.overallScore} in=${resp.usage.prompt} out=${resp.usage.completion}`,
      );
      return grade;
    } catch (err) {
      this.logger?.warn(`gradeResume failed: ${errorMessage(err)}`);
      return null;
    }
  }
}
