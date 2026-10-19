// Команда grade-resume: оценка резюме ИИ.
// Форматирование (консоль + Markdown) — presentation/cli/format/grade-report.ts,
// оценка — application/grade.ts (резюме читается там, домен файлов не знает).
import { writeFileSync } from "fs";
import { join } from "path";
import { aiProvider } from "../../../composition.js";
import { gradeResumeFromFile } from "../../../application/grade.js";
import { buildMarkdown, formatGrade } from "../format/grade-report.js";

async function cmdGradeResume(opts: Record<string, any> = {}) {
  const result = await gradeResumeFromFile(aiProvider(), { resume: opts.resume });
  formatGrade(result);

  if (result) {
    const md = buildMarkdown(result);
    const filePath = join(process.cwd(), "resume-grade.md");
    writeFileSync(filePath, md, "utf-8");
    console.log(`\n  Результат сохранён: resume-grade.md\n`);
  }
}

export { cmdGradeResume as default };
export { formatGrade };
