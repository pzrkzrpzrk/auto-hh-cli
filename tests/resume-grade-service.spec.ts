// ResumeGradeService: транспорт ИИ, терпимость к форме ответа и диагностика (T-28).
// Ключ не нужен: порт ИИ — фейк, логи — коллектор строк.
import { describe, expect, it } from "vitest";
import { ResumeGradeService } from "@/application/grade/ResumeGradeService";
import type { Logger } from "@/domain/logging";
import type { Resume } from "@/domain/models";
import type { AiChatOptions, AiChatResult, AiProvider } from "@/domain/ports";

class FakeAi implements AiProvider {
  readonly calls: AiChatOptions[] = [];

  constructor(private readonly reply: (opts: AiChatOptions) => AiChatResult | Promise<AiChatResult>) {}

  chat(opts: AiChatOptions): Promise<AiChatResult> {
    this.calls.push(opts);
    return Promise.resolve(this.reply(opts));
  }
}

class FakeLogger implements Logger {
  readonly warns: string[] = [];
  readonly debugs: string[] = [];

  info(): void {}
  error(): void {}
  warn(message: string): void {
    this.warns.push(message);
  }
  debug(message: string): void {
    this.debugs.push(message);
  }
}

const resume: Resume = {
  name: "backend",
  id: "r1",
  type: "text",
  text: "Резюме: Node.js, TypeScript",
  filename: "backend.md",
};

function reply(text: string | null): AiChatResult {
  return { text, usage: { prompt: 120, completion: 40 } };
}

const RAW = {
  overallScore: 82,
  overallAssessment: "Сильное резюме",
  strengths: ["Опыт"],
  weaknesses: ["Нет метрик"],
  missing: ["Ссылка на GitHub"],
  recommendations: ["Добавить цифры"],
  categoryScores: {
    firstImpression: { score: 20, max: 25 },
    positioning: { score: 22 },
    redFlags: { score: 30, max: 20 },
  },
  detailedAnalysis: [
    { category: "Грамотность", status: "good", description: "чисто", quotes: ["текст"], recommendations: ["—"] },
    { category: "Красные флаги", status: "attention", description: "перерыв", quotes: "не массив" },
  ],
};

describe("ResumeGradeService.grade", () => {
  it("просит JSON, подставляет резюме и разбирает оценку", async () => {
    const ai = new FakeAi(() => reply(`\`\`\`json\n${JSON.stringify(RAW)}\n\`\`\``));
    const logger = new FakeLogger();

    const grade = await new ResumeGradeService(ai, logger).grade(resume);

    expect(ai.calls[0].json).toBe(true);
    expect(ai.calls[0].label).toBe("оценка резюме");
    expect(JSON.stringify(ai.calls[0].messages)).toContain("Резюме: Node.js, TypeScript");
    expect(grade?.overallScore).toBe(82);
    expect(grade?.strengths).toEqual(["Опыт"]);
    expect(grade?.detailedAnalysis).toHaveLength(2);
    expect(grade?.detailedAnalysis[1].status).toBe("attention");
    expect(grade?.detailedAnalysis[1].quotes).toEqual([]);
    expect(logger.debugs[0]).toBe("gradeResume: score=82 in=120 out=40");
  });

  it("зажимает баллы и подставляет веса категорий из промпта", async () => {
    const ai = new FakeAi(() => reply(JSON.stringify(RAW)));

    const grade = await new ResumeGradeService(ai).grade(resume);

    // redFlags: модель дала 30 при max 20 — балл зажимается.
    expect(grade?.categoryScores.redFlags.score).toBe(20);
    // positioning: max не пришёл — берётся вес промпта.
    expect(grade?.categoryScores.positioning.max).toBe(25);
    // contextAndScale отсутствует целиком — нулевой балл с весом промпта.
    expect(grade?.categoryScores.contextAndScale).toEqual({ score: 0, max: 20 });
  });

  it("приводит строковые числа и границы общего балла", async () => {
    const ai = new FakeAi(() => reply(JSON.stringify({ overallScore: "150" })));

    const grade = await new ResumeGradeService(ai).grade(resume);

    expect(grade?.overallScore).toBe(100);
    expect(grade?.strengths).toEqual([]);
  });

  it("пустой ответ модели — null и предупреждение", async () => {
    const logger = new FakeLogger();

    const grade = await new ResumeGradeService(new FakeAi(() => reply(null)), logger).grade(resume);

    expect(grade).toBeNull();
    expect(logger.warns).toEqual(["gradeResume: empty response"]);
  });

  it("ошибка модели — null и текст прежнего лога", async () => {
    const logger = new FakeLogger();
    const failing = new FakeAi(() => {
      throw new Error("boom");
    });

    const grade = await new ResumeGradeService(failing, logger).grade(resume);

    expect(grade).toBeNull();
    expect(logger.warns[0]).toBe("gradeResume failed: boom");
  });

  it("ответ не объект (массив) — null, а не падение отчёта", async () => {
    const logger = new FakeLogger();

    const grade = await new ResumeGradeService(new FakeAi(() => reply("[]")), logger).grade(resume);

    expect(grade).toBeNull();
    expect(logger.warns).toEqual(["gradeResume: unexpected response shape"]);
  });

  it("без ключа и без резюме не трогает ИИ", async () => {
    const ai = new FakeAi(() => reply(JSON.stringify(RAW)));
    const logger = new FakeLogger();

    expect(await new ResumeGradeService(null, logger).grade(resume)).toBeNull();
    expect(await new ResumeGradeService(ai, logger).grade(null)).toBeNull();

    expect(ai.calls).toHaveLength(0);
    expect(logger.warns).toEqual([
      "gradeResume: no API client (check API key)",
      "gradeResume: resume not found (set RESUME_PATH)",
    ]);
  });
});
