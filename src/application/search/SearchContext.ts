// Контекст прогона поиска: всё, что нужно стадиям конвейера.
import type { AppConfig } from "../../domain/ports.js";
import type { VacancyListItem } from "../../domain/search/types.js";
import type { SearchQuery } from "../../domain/search/SearchQuery.js";
import type { SearchReportWriter } from "../../domain/ports.js";
import type { SearchEvent } from "./SearchEvent.js";
import type SearchCache from "./SearchCache.js";
import type { VacancyCollector } from "./VacancyCollector.js";

export interface SearchContext {
  /** Флаги команды: config, reset и прочие, которые читают стадии. */
  readonly opts: Record<string, any>;
  readonly cfg: AppConfig;
  readonly query: SearchQuery;
  readonly cache: SearchCache;
  readonly collector: VacancyCollector;
  /** Куда записать выдачу за день (порт скрывает data/search/ и формат .md). */
  readonly writer: SearchReportWriter;
  /** Куда сообщать о фазах (команда печатает). */
  readonly report: (event: SearchEvent) => void;
  /** Собранные элементы выдачи — вход для файла и карточек. */
  items: VacancyListItem[];
  /** Стадия просит остановить конвейер (например, ничего не найдено). */
  stopped: boolean;
}
