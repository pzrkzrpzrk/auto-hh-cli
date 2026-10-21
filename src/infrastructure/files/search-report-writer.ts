// Адаптер порта SearchReportWriter: выдача поиска в папку резюме (data/hh-parsing/<name - id>/search).
// Формат файла и дедупликацию по id оставляем в search-output.ts — здесь только граница порта.
import { writeSearchResults } from "@/infrastructure/files/search-output.js";
import type { SearchReportWriter } from "@/domain/ports.js";
import type { ResumeRef, SearchEntry, SearchFileResult } from "@/domain/models.js";

class FileSearchReportWriter implements SearchReportWriter {
  write(
    entries: SearchEntry[],
    opts: { date?: string; query?: string; resume?: ResumeRef | null } = {},
  ): Promise<SearchFileResult[]> {
    return Promise.resolve(writeSearchResults(entries, opts));
  }
}

export default FileSearchReportWriter;
