// GradePrompt: тексты промпта оценки резюме — Domain Service без I/O.
// Формулировки влияют на ответы модели, поэтому проверяются как инвариант: веса категорий,
// формат JSON и подстановка резюме (включая PDF-фолбэк вместо текста).
import { describe, expect, it } from "vitest";
import { GradePrompt } from "@/domain/grade-resume/GradePrompt";
import type { Resume } from "@/domain/models";

const prompt = new GradePrompt();

const textResume: Resume = {
  name: "backend",
  id: "r1",
  type: "text",
  text: "Резюме: Node.js, TypeScript",
  filename: "backend.md",
};

describe("GradePrompt.system", () => {
  it("задаёт пять взвешенных категорий с суммой весов 100", () => {
    const text = prompt.system();

    const weights = [...text.matchAll(/\(max (\d+)\)/g)].map(match => Number(match[1]));
    expect(weights).toEqual([25, 25, 20, 20, 10]);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it("описывает контракт ответа: строгий JSON и девять категорий разбора", () => {
    const text = prompt.system();

    expect(text).toContain("Формат ответа — строго JSON:");
    expect(text).toContain('"overallScore"');
    expect(text).toContain('"categoryScores"');
    expect(text).toContain('"detailedAnalysis"');
    expect(text).toContain("9. Качество описания опыта");
    expect(text).toContain("Экранируй кавычки внутри строк");
  });
});

describe("GradePrompt.user", () => {
  it("вставляет текст резюме после вводной строки", () => {
    expect(prompt.user(textResume)).toBe("Оцени следующее резюме:\n\nРезюме: Node.js, TypeScript");
  });

  it("для PDF подставляет пометку о файле вместо текста", () => {
    const pdf: Resume = { name: "cv", id: "r2", type: "pdf", filename: "cv.pdf" };

    const text = prompt.user(pdf);

    expect(text).toContain("[PDF] cv.pdf");
    expect(text).not.toContain("undefined");
  });
});
