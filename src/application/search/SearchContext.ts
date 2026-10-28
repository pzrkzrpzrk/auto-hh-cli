// Контекст прогона поиска: всё, что нужно стадиям конвейера.
import type { AppConfig } from "@/domain/ports.js";
import type { ResumeRef } from "@/domain/models.js";
import type { VacancyListItem } from "@/domain/search/types.js";
import type { SearchQuery } from "@/domain/search/SearchQuery.js";
import type { SearchReportWriter } from "@/domain/ports.js";
import type { SearchEvent } from "@/application/search/SearchEvent.js";
import type { SearchOptions } from "@/application/options.js";
import type SearchCache from "@/application/search/SearchCache.js";
import type { VacancyCollector } from "@/application/search/VacancyCollector.js";

export interface SearchContext {
  /** Флаги команды: config, reset и прочие, которые читают стадии. */
  readonly opts: SearchOptions;
  readonly cfg: AppConfig;
  /** Резюме, в чью папку пишется выдача; null — no-resume. */
  readonly resume: ResumeRef | null;
  readonly query: SearchQuery;
  readonly cache: SearchCache;
  readonly collector: VacancyCollector;
  /** Куда записать выдачу за день (порт скрывает data/hh-parsing/<резюме>/search/ и формат .md). */
  readonly writer: SearchReportWriter;
  /** Куда сообщать о фазах (команда печатает). */
  readonly report: (event: SearchEvent) => void;
  /** Собранные элементы выдачи — вход для файла и карточек. */
  items: VacancyListItem[];
  /** Стадия просит остановить конвейер (например, ничего не найдено). */
  stopped: boolean;
}
