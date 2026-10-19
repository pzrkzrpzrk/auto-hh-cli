// Адаптер порта ResumeProvider: чтение резюме с диска (RESUME_PATH / RESUMES_DIR).
import { loadResume } from "./resume-loader.js";
import type { ResumeProvider } from "../../domain/digest/ports.js";
import type { Resume } from "../../domain/models.js";

class FileResumeProvider implements ResumeProvider {
  load(name?: string): Resume | null {
    return loadResume(name);
  }
}

export default FileResumeProvider;
