// Контекст прогона поиска: всё, что нужно стадиям конвейера.
import type { SearchConfig, VacancyListItem } from "../../domain/search/types.js";
import type { SearchQuery } from "../../domain/search/SearchQuery.js";
import type { SearchEvent } from "./SearchEvent.js";
import type SearchCache from "./SearchCache.js";
import type { VacancyCollector } from "./VacancyCollector.js";

export interface SearchContext {
  /** Флаги команды: config, reset и прочие, которые читают стадии. */
  readonly opts: Record<string, any>;
  readonly cfg: { search: SearchConfig; [key: string]: any };
  readonly query: SearchQuery;
  readonly cache: SearchCache;
  readonly collector: VacancyCollector;
  /** Куда сообщать о фазах (команда печатает). */
  readonly report: (event: SearchEvent) => void;
  /** Собранные элементы выдачи — вход для файла и карточек. */
  items: VacancyListItem[];
  /** Стадия просит остановить конвейер (например, ничего не найдено). */
  stopped: boolean;
}
