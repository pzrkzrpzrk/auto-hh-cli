// Адаптация резюме под вакансию: ядро, ранжирование секций и бюджет — на чистых данных.
import { describe, expect, it } from "vitest";
import { adaptResumeForVacancy, DEFAULT_ADAPT_BUDGET } from "@/domain/adapt-resume/index";
import type { Resume, Vacancy } from "@/domain/models";

const resume: Resume = {
  name: "resume",
  id: "r1",
  type: "text",
  filename: "resume.txt",
  text: [
    "# Иван Петров",
    "Senior Backend, Москва, зарплата 300000, готов к переезду",
    "",
    "## Ключевые навыки",
    "- TypeScript",
    "- Node.js",
    "- PostgreSQL",
    "- Kubernetes",
    "",
    "## Опыт работы",
    "- Разрабатывал сервисы на Node.js и TypeScript",
    "- Настраивал PostgreSQL",
    "",
    "## Образование",
    "- МГУ, прикладная математика",
  ].join("\n"),
};

const vacancy: Vacancy = {
  id: 101,
  name: "Backend разработчик",
  description: "<p>Нужен Node.js и TypeScript, PostgreSQL</p>",
  key_skills: [{ name: "TypeScript" }, { name: "PostgreSQL" }],
};

const pdfResume: Resume = { name: "cv", id: "r2", type: "pdf", filename: "cv.pdf" };

describe("adaptResumeForVacancy", () => {
  it("оставляет шапку, навыки и релевантные секции, отбрасывая нерелевантные", () => {
    const adapted = adaptResumeForVacancy(resume, vacancy);

    expect(adapted).not.toBeNull();
    expect(adapted).toContain("# Иван Петров");
    expect(adapted).toContain("## Ключевые навыки");
    expect(adapted).toContain("## Опыт работы");
    expect(adapted).not.toContain("## Образование");
    expect(adapted!.length).toBeLessThanOrEqual(DEFAULT_ADAPT_BUDGET);
  });

  it("в навыках сначала идут совпавшие с вакансией, затем остальные", () => {
    const adapted = adaptResumeForVacancy(resume, vacancy)!;
    const skills = adapted.split("## Ключевые навыки")[1];

    expect(skills).toContain("- TypeScript");
    expect(skills.indexOf("- TypeScript")).toBeLessThan(skills.indexOf("- Kubernetes"));
  });

  it("ранжирует секции по весу совпадений", () => {
    const ranking: Resume = {
      ...resume,
      text: ["# Кандидат", "", "## Опыт A", "PostgreSQL", "", "## Опыт B", "TypeScript", "PostgreSQL"].join("\n"),
    };
    const adapted = adaptResumeForVacancy(ranking, { ...vacancy, name: "Backend", description: "" })!;

    expect(adapted).toContain("## Опыт A");
    expect(adapted).toContain("## Опыт B");
    expect(adapted.indexOf("## Опыт B")).toBeLessThan(adapted.indexOf("## Опыт A"));
  });

  it("без совпадений возвращает ядро, а не пустую строку", () => {
    const unrelated: Vacancy = {
      id: 2,
      name: "Аналитик",
      description: "<p>SQL и таблицы</p>",
      key_skills: [{ name: "Kubernetes" }],
    };
    const adapted = adaptResumeForVacancy(resume, unrelated)!;

    expect(adapted).toContain("# Иван Петров");
    expect(adapted).toContain("## Ключевые навыки");
    expect(adapted).not.toContain("## Опыт работы");
  });

  it("не адаптирует PDF, пустой текст и отсутствующее резюме", () => {
    expect(adaptResumeForVacancy(null, vacancy)).toBeNull();
    expect(adaptResumeForVacancy(pdfResume, vacancy)).toBeNull();
    expect(adaptResumeForVacancy({ ...resume, text: "   " }, vacancy)).toBeNull();
    expect(adaptResumeForVacancy({ ...resume, text: undefined }, vacancy)).toBeNull();
  });

  it("резюме без ##-заголовков отдаётся целиком", () => {
    const flat: Resume = { ...resume, text: "# Кандидат\nОпыт: Node.js и TypeScript" };
    expect(adaptResumeForVacancy(flat, vacancy)).toBe("# Кандидат\nОпыт: Node.js и TypeScript");
  });

  it("соблюдает бюджет символов и сохраняет ядро", () => {
    const long: Resume = {
      ...resume,
      text: [
        "# Кандидат",
        "",
        "## Опыт",
        ...Array.from({ length: 20 }, (_, i) => `Строка ${i}: TypeScript и PostgreSQL, немного текста для объёма`),
      ].join("\n"),
    };
    const adapted = adaptResumeForVacancy(long, vacancy, { budgetChars: 500 })!;

    expect(adapted.length).toBeLessThanOrEqual(500);
    expect(adapted).toContain("# Кандидат");
    expect(adapted).not.toContain("Строка 19");
  });

  it("бюджет ниже 500 поднимается до границы", () => {
    const medium: Resume = {
      ...resume,
      text: `# Кандидат\n\n## Опыт\n${"TypeScript и PostgreSQL. ".repeat(12)}`,
    };
    expect(adaptResumeForVacancy(medium, vacancy, { budgetChars: 10 })!.length).toBeGreaterThan(100);
  });

  it("ограничивает блок навыков, не теряя совпавшие строки", () => {
    const manySkills: Resume = {
      ...resume,
      text: [
        "# Кандидат",
        "",
        "## Навыки",
        "- TypeScript",
        ...Array.from({ length: 80 }, (_, i) => `- Навык номер ${i} с описанием`),
      ].join("\n"),
    };
    const adapted = adaptResumeForVacancy(manySkills, vacancy)!;
    const skills = adapted.split("## Навыки")[1];

    expect(skills).toContain("- TypeScript");
    expect(skills).not.toContain("- Навык номер 79 с описанием");
  });
});
