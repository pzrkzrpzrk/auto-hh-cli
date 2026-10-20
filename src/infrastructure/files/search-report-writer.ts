// Адаптер порта SearchReportWriter: выдача поиска в data/search/<дата>/<регион>/search.md.
// Формат файла и дедупликацию по id оставляем в search-output.ts — здесь только граница порта.
import { writeSearchResults } from "./search-output.js";
import type { SearchReportWriter } from "../../domain/ports.js";
import type { SearchEntry, SearchFileResult } from "../../domain/models.js";

class FileSearchReportWriter implements SearchReportWriter {
  write(entries: SearchEntry[], opts: { date?: string; query?: string } = {}): Promise<SearchFileResult[]> {
    return Promise.resolve(writeSearchResults(entries, opts));
  }
}

export default FileSearchReportWriter;
