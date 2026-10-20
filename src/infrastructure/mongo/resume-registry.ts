// Адаптер порта ResumeRegistry: регистрация резюме в коллекции resumes.
import { listResumes, registerResume } from "@/infrastructure/mongo/resume-store.js";
import type { RegisteredResume, ResumeRegistry } from "@/domain/digest/ports.js";
import type { Resume } from "@/domain/models.js";

class MongoResumeRegistry implements ResumeRegistry {
  register(resume: Resume): Promise<void> {
    return registerResume(resume);
  }

  listRegistered(): Promise<RegisteredResume[]> {
    return listResumes();
  }
}

export default MongoResumeRegistry;
