// Адаптер порта ResumeRegistry: регистрация резюме в коллекции resumes.
import { registerResume } from "./resume-store.js";
import type { ResumeRegistry } from "../../domain/digest/ports.js";
import type { Resume } from "../../domain/models.js";

class MongoResumeRegistry implements ResumeRegistry {
  register(resume: Resume): Promise<void> {
    return registerResume(resume);
  }
}

export default MongoResumeRegistry;
