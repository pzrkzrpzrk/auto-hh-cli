// Отчёт по оценке резюме: формат resume-grade.md — инвариант (файл читают люди,
// структура сложилась до T-28 и не должна поехать при переходе на VO).
import { describe, expect, it } from "vitest";
import { ResumeGrade } from "@/domain/grade-resume/ResumeGrade";
import { buildMarkdown } from "@/presentation/cli/format/grade-report";

const RAW = {
  overallScore: 82,
  overallAssessment: "Сильное резюме",
  strengths: ["Опыт"],
  weaknesses: ["Нет метрик"],
  missing: ["Ссылка на GitHub"],
  recommendations: ["Добавить цифры"],
  categoryScores: {
    firstImpression: { score: 20, max: 25 },
    positioning: { score: 22, max: 25 },
    redFlags: { score: 20, max: 20 },
    contextAndScale: { score: 15, max: 20 },
    shortlistReadiness: { score: 5, max: 10 },
  },
  detailedAnalysis: [
    { category: "Грамотность", status: "good", description: "чисто", quotes: ["цитата"], recommendations: ["совет"] },
    { category: "Красные флаги", status: "attention", description: "перерыв" },
  ],
};

describe("buildMarkdown", () => {
  it("печатает заголовок, списки, таблицу категорий и разбор", () => {
    const grade = ResumeGrade.fromModel(RAW);
    expect(grade).not.toBeNull();

    const md = buildMarkdown(grade!);

    expect(md).toContain("## Общая оценка: 82/100");
    expect(md).toContain("### Сильные стороны");
    expect(md).toContain("- Опыт");
    expect(md).toContain("| Первое впечатление | ████████░░ 20/25 |");
    expect(md).toContain("### Грамотность — ✅ Хорошо");
    expect(md).toContain("### Красные флаги — ⚠️ Требует внимания");
    expect(md).toContain("> цитата");
    expect(md).toContain("**Рекомендации:**");
  });

  it("не печатает пустые блоки", () => {
    const grade = ResumeGrade.fromModel({ overallScore: 10 });

    const md = buildMarkdown(grade!);

    expect(md).not.toContain("### Сильные стороны");
    expect(md).not.toContain("## Детальный разбор");
    expect(md).toContain("| Готовность к шортлисту | ░░░░░░░░░░ 0/10 |");
  });
});
