// Клиент к hh.ru через Playwright-скрейпинг — тонкий фасад над сессией браузера
// и читателями страниц. Публичный API прежний, поэтому vacancy-source/resume-source
// и composition root не менялись.
//
// API api.hh.ru заблокирован ddos-guard для нашего IP, поэтому ходим на основной
// сайт hh.ru как обычный браузер и забираем JSON из <template id="HH-Lux-InitialState">.
// Жизненный цикл браузера и капча — в session.ts, чтение страниц — в *-page-reader.ts,
// разбор состояния — в vacancy-mapping.ts и resume-parser.ts.
import type { HhResumeData, HhResumeSummary, Vacancy } from "@/domain/models.js";
import type { SearchParams, SearchPageResult } from "@/domain/search/types.js";
import HHResumePageReader from "@/infrastructure/hh/resume-page-reader.js";
import downloadResumePdf from "@/infrastructure/hh/resume-pdf.js";
import HHPageSession from "@/infrastructure/hh/session.js";
import HHVacancyPageReader from "@/infrastructure/hh/vacancy-page-reader.js";
import HHVacancySearchReader from "@/infrastructure/hh/search-page-reader.js";

class HHClient {
  private readonly session = new HHPageSession();
  private readonly searchReader = new HHVacancySearchReader(this.session);
  private readonly vacancyReader = new HHVacancyPageReader(this.session);
  private readonly resumeReader = new HHResumePageReader(this.session);

  init(headless = true): Promise<void> {
    return this.session.init(headless);
  }

  close(): Promise<void> {
    return this.session.close();
  }

  searchVacancies(params: SearchParams): Promise<SearchPageResult> {
    return this.searchReader.searchVacancies(params);
  }

  getVacancy(id: string | number): Promise<Vacancy | null> {
    return this.vacancyReader.getVacancy(id);
  }

  listMyResumes(): Promise<HhResumeSummary[]> {
    return this.resumeReader.listMyResumes();
  }

  getMyResume(hash: string): Promise<HhResumeData | null> {
    return this.resumeReader.getMyResume(hash);
  }

  downloadResumePdf(hash: string, destPath: string): Promise<string | null> {
    return downloadResumePdf(this.session, hash, destPath);
  }
}

export default HHClient;
