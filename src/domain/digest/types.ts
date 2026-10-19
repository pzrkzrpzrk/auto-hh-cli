// Типы сценария дайджеста: конфигурация, флаги запуска и снимок кэша.
// Живут в домене, чтобы сценарий не зависел от формы config.json и Mongo-документов.
import type { SearchCacheSnapshot } from "../search/types.js";

/** Секции config.json, которые читает политика дайджеста. */
export interface DigestConfig {
  apply?: {
    minClaudeScore?: number;
    maxPerRun?: number;
    dryRun?: boolean;
    [key: string]: unknown;
  };
  api?: { apiKey?: string; [key: string]: unknown };
  adaptResume?: boolean;
  search?: {
    area?: (string | number)[] | string | number;
    search_period?: number | string;
    [key: string]: unknown;
  };
  filter?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Флаги команды `digest` (то, что раньше читалось из `opts` россыпью). */
export interface DigestRunOptions {
  config?: string;
  resume?: string;
  limit?: number;
  dryRun?: boolean;
  claude?: boolean;
  json?: boolean;
  [key: string]: unknown;
}

/**
 * Снимок кэша последнего поиска: страницы и карточки — как у search,
 * плюс вердикты судьи и письма, которые нужны шагу digest.
 */
export interface DigestCacheSnapshot extends SearchCacheSnapshot {
  judgements: Record<string, any>;
  coverLetters: Record<string, string>;
}
