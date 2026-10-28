// Адаптер порта ResumeRegistry: регистрация резюме в таблице resumes.
import { findResume, listResumes, registerResume } from "@/infrastructure/sqlite/resume-store.js";
import type { RegisteredResume, ResumeRegistration, ResumeRegistry } from "@/domain/digest/ports.js";
import type { Resume } from "@/domain/models.js";

class SqliteResumeRegistry implements ResumeRegistry {
  register(resume: Resume): Promise<ResumeRegistration> {
    return registerResume(resume);
  }

  listRegistered(): Promise<RegisteredResume[]> {
    return listResumes();
  }

  find(resumeId: string): Promise<RegisteredResume | null> {
    return findResume(resumeId);
  }
}

export default SqliteResumeRegistry;
