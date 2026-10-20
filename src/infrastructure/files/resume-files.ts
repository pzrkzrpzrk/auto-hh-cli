// Адаптер порта ResumeFiles: файлы резюме на диске (RESUME_PATH / RESUMES_DIR / data/resumes).
// Раскладку каталога и имена файлов знает только он — сценарии работают с портом.
import fs from "fs";
import path from "path";
import { ensureResumesDir, listResumes, loadResume, resumesDir } from "@/infrastructure/files/resume-loader.js";
import type { Resume } from "@/domain/models.js";
import type { ResumeFile, ResumeFiles } from "@/domain/ports.js";
import type { ResumeProvider } from "@/domain/digest/ports.js";

class FileResumeFiles implements ResumeFiles, ResumeProvider {
  ensureDir(): string {
    return ensureResumesDir();
  }

  list(): ResumeFile[] {
    return listResumes();
  }

  load(name?: string): Resume | null {
    return loadResume(name);
  }

  pathFor(name: string, kind: 'md' | 'pdf' = 'md'): string {
    const dir = resumesDir();
    return kind === 'pdf' ? path.join(dir, 'pdf', `${name}.pdf`) : path.join(dir, `${name}.md`);
  }

  exists(file: string): boolean {
    return fs.existsSync(file);
  }

  save(name: string, markdown: string, opts: { overwrite?: boolean } = {}): { file: string; saved: boolean } {
    const file = this.pathFor(name, 'md');
    if (fs.existsSync(file) && !opts.overwrite) return { file, saved: false };

    ensureResumesDir();
    fs.writeFileSync(file, markdown, 'utf-8');
    return { file, saved: true };
  }
}

export default FileResumeFiles;
