// Запись текстового артефакта в каталог запуска (отчёты CLI).
// Раньше cmd-grade-resume писал resume-grade.md через fs прямо из presentation;
// теперь файловый I/O — за портом TextFileWriter, а команда только печатает путь.
import { writeFileSync } from "fs";
import { join } from "path";
import type { TextFileWriter } from "@/domain/ports.js";

export class CwdTextFileWriter implements TextFileWriter {
  /** Сохраняет текст в каталоге запуска и возвращает имя, которое печатает команда. */
  save(name: string, text: string): string {
    writeFileSync(join(process.cwd(), name), text, "utf-8");
    return name;
  }
}
