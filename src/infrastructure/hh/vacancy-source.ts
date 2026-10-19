// Адаптер порта VacancySource поверх Playwright-клиента hh.ru (Adapter).
// Сценарии видят только searchVacancies/getVacancy, а init/close браузера — здесь.
import HHClient from "./client.js";
import type { VacancySource } from "../../domain/search/VacancySource.js";
import type { SearchParams, SearchPageResult } from "../../domain/search/types.js";
import type { Vacancy } from "../../domain/models.js";

class HHVacancySource implements VacancySource {
  constructor(private readonly client: HHClient) {}

  searchVacancies(params: SearchParams): Promise<SearchPageResult> {
    return this.client.searchVacancies(params);
  }

  getVacancy(id: string | number): Promise<Vacancy | null> {
    return this.client.getVacancy(id);
  }

  /** Лениво: клиент сам открывает браузер при первом запросе. */
  open(): Promise<void> {
    return this.client.init();
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export default HHVacancySource;
