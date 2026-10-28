// Команда grade-resume: оценка резюме ИИ.
// Форматирование (консоль + Markdown) — presentation/cli/format/grade-report.ts,
// оценка — application/grade.ts, запись файла — порт TextFileWriter из composition root.
import { gradeDeps, gradeReportFile } from "@/composition.js";
import { gradeResumeFromFile } from "@/application/grade.js";
import { buildMarkdown, formatGrade } from "@/presentation/cli/format/grade-report.js";

/** Параметры пункта меню: имя резюме (без него — резюме по умолчанию из .env). */
interface GradeCommandOptions {
  resume?: string;
}

async function cmdGradeResume(opts: GradeCommandOptions = {}) {
  const result = await gradeResumeFromFile({ resume: opts.resume }, gradeDeps);
  formatGrade(result);

  if (result) {
    const saved = gradeReportFile.save("resume-grade.md", buildMarkdown(result));
    console.log(`\n  Результат сохранён: ${saved}\n`);
  }
}

export { cmdGradeResume as default };
export { formatGrade };
