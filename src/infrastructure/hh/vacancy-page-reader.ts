// Читатель карточки вакансии. В актуальном ответе hh.ru она лежит в
// vacancyView.vacancyFull.vacancy; прежние формы (vacancyView.vacancy, плоский
// vacancyView) поддержаны как фолбэки — без этого карточка выходила пустой.
import log from "@/shared/logger.js";
import type { Vacancy } from "@/domain/models.js";
import type { PageFetcher } from "@/infrastructure/hh/session.js";
import { buildFieldsDictionary } from "@/infrastructure/hh/vacancy-fields.js";
import { mapVacancyView } from "@/infrastructure/hh/vacancy-mapping.js";

class HHVacancyPageReader {
  constructor(private readonly pages: PageFetcher) {}

  async getVacancy(id: string | number): Promise<Vacancy | null> {
    const url = `https://hh.ru/vacancy/${id}`;
    const data = await this.pages.fetchInitialState(url);
    const view = data?.vacancyView || null;
    const node = view?.vacancyFull?.vacancy ?? view?.vacancy ?? view;
    if (!node) {
      log.warn(`No vacancy card on ${url}`);
      return null;
    }
    const full = mapVacancyView(node, {
      idHint: id,
      links: view?.vacancyFull?.links || null,
      translations: view?.translations || null,
      fields: buildFieldsDictionary(data.vacancyFieldsDictionary),
    });
    if (!full) return null;
    // Пустую/неразобранную карточку не отдаём: лучше null (шаги залогируют и пропустят),
    // чем мусорный документ с vacancyId «undefined» в cacheFull.
    if (!full.id || full.id === 'undefined' || !full.name) {
      log.warn(`Empty vacancy card ${id} (id=${full.id}, name=${full.name})`);
      return null;
    }
    return full;
  }
}

export default HHVacancyPageReader;
