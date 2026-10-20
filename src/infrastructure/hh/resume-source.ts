// Адаптер порта ResumeSource поверх Playwright-клиента hh.ru (Adapter).
// Меню открывает сессию и закрывает её само; сценарий скачивания этим не занимается.
import HHClient from "@/infrastructure/hh/client.js";
import type { ResumeSource } from "@/domain/ports.js";
import type { HhResumeData, HhResumeSummary } from "@/domain/models.js";

class HHResumeSource implements ResumeSource {
  constructor(private readonly client: HHClient) {}

  open(): Promise<void> {
    return this.client.init();
  }

  listMyResumes(): Promise<HhResumeSummary[]> {
    return this.client.listMyResumes();
  }

  getMyResume(hash: string): Promise<HhResumeData | null> {
    return this.client.getMyResume(hash);
  }

  downloadResumePdf(hash: string, destPath: string): Promise<string | null> {
    return this.client.downloadResumePdf(hash, destPath);
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export default HHResumeSource;
