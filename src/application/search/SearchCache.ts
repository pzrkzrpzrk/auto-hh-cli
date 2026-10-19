// Репозиторий кэша поиска (Repository): страницы выдачи (cachePages) и полные карточки (cacheFull).
// Сценарии больше не мутируют объект кэша руками — они просят репозиторий, а он пишет в хранилище.
import type { CacheStore } from "../../domain/ports.js";
import type { SearchCacheSnapshot, Vacancy, VacancyListItem } from "../../domain/search/types.js";

class SearchCache {
  constructor(
    private readonly doc: SearchCacheSnapshot,
    private readonly store: CacheStore,
  ) {}

  /** Снимок целиком — для шагов digest/cover, которым нужны все поля кэша. */
  get raw(): SearchCacheSnapshot {
    return this.doc;
  }

  get date(): string {
    return this.doc.date;
  }

  page(key: string): any[] | null {
    return this.doc.pages[key] ?? null;
  }

  /** Записать страницу и сразу сохранить её в хранилище (как раньше: мутация → savePage). */
  async savePage(key: string, items: any[]): Promise<void> {
    this.doc.pages[key] = items;
    await this.store.savePage(this.doc, key);
  }

  full(id: string | number): any | null {
    return this.doc.fullById[String(id)] ?? null;
  }

  hasFull(id: string | number): boolean {
    return Boolean(this.doc.fullById[String(id)]);
  }

  /** Сохранить полную карточку: в снимок и в хранилище, с датой текущего поиска. */
  async saveFull(vacancy: Vacancy): Promise<void> {
    this.doc.fullById[String(vacancy.id)] = vacancy;
    await this.store.saveFullVacancy(vacancy, this.dateAsDate());
  }

  /** Плоский список собранных вакансий без дублей — вход для шага digest. */
  flatten(): VacancyListItem[] {
    const byId = new Map<string, VacancyListItem>();
    for (const page of Object.keys(this.doc.pages || {})) {
      for (const item of this.doc.pages[page] || []) {
        const id = String(item.id);
        if (!byId.has(id)) byId.set(id, item);
      }
    }
    return [...byId.values()];
  }

  private dateAsDate(): Date | undefined {
    return this.doc.date ? new Date(`${this.doc.date}T00:00:00.000Z`) : undefined;
  }
}

export default SearchCache;
