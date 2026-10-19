// Domain Service «сбор вакансий»: страницы выдачи и полные карточки.
// Один класс на три сценария (search/digest/cover) вместо трёх свободных функций;
// кэш и источник приходят портами, логи — как раньше.
import { SearchQuery } from "../../domain/search/SearchQuery.js";
import type { VacancySource } from "../../domain/search/VacancySource.js";
import type { VacancyListItem } from "../../domain/search/types.js";
import type { HistoryState, HistoryStore } from "../../domain/ports.js";
import SearchCache from "./SearchCache.js";
import { PageIterator } from "./PageIterator.js";
import type { FullCardPolicy } from "./FullCardPolicy.js";
import log from "../../shared/logger.js";

/** Сводка по догрузке полных карточек. */
export interface FullCardsSummary {
  candidates: number;
  cached: number;
  skippedSeen: number;
  saved: number;
  failed: number;
}

/** Прогресс догрузки карточек — команда печатает его в прежнем порядке. */
export type FullCardsProgress =
  | { type: 'start'; total: number; cached: number; skippedSeen: number }
  | { type: 'progress'; done: number; total: number; name: string };

export class VacancyCollector {
  constructor(
    private readonly source: VacancySource,
    private readonly cache: SearchCache,
    /** История нужна только политике «пропускать просмотренные». */
    private readonly history?: HistoryStore,
  ) {}

  /** Страницы выдачи по всем проходам запроса: кэш → источник, с сохранением в кэш. */
  async collectPages(query: SearchQuery): Promise<VacancyListItem[]> {
    const results: VacancyListItem[] = [];
    for (const bucket of query.buckets()) {
      for await (const view of new PageIterator(this.source, this.cache, query).pages(bucket)) {
        if (view.fromCache) {
          log.info(`Page ${view.key.page}${bucket.label}: ${view.items.length} vacancies (cached)`);
        } else {
          log.info(`Page ${view.key.page}${bucket.label}: ${view.items.length} vacancies (total ${view.found})`);
          await this.cache.savePage(view.key.key, view.items);
        }
        results.push(...view.items);
      }
    }
    return results;
  }

  /**
   * Полные карточки (описание, навыки): берём из кэша, недостающие — из источника.
   * Каждая сохраняется сразу — прерывание не теряет прогресс.
   */
  async ensureFullCards(
    items: Array<VacancyListItem | string | number>,
    policy: FullCardPolicy,
    onProgress?: (event: FullCardsProgress) => void,
  ): Promise<FullCardsSummary & { failedIds: string[] }> {
    const stats = { candidates: 0, cached: 0, skippedSeen: 0, saved: 0, failed: 0, failedIds: [] as string[] };
    // На входе — элементы выдачи (id + name для прогресса) либо просто id (шаг cover).
    const entries = (items || []).map(item => (item && typeof item === 'object' ? item : { id: item }));
    const ids: string[] = [...new Set<string>(entries.map(item => String(item.id)))];
    stats.candidates = ids.length;
    if (!ids.length) return stats;

    // Просмотренные не качаем, если политика это разрешает: digest всё равно их пропускает,
    // cover просит качать всем, чтобы не срезать вакансии без писем.
    const seen = policy.skipSeen && this.history
      ? (await this.history.load().catch((): HistoryState => ({ applied: {}, seen: {} }))).seen
      : {};
    const todo: string[] = [];
    for (const id of ids) {
      if (this.cache.hasFull(id)) { stats.cached++; continue; }
      if (seen[id]) { stats.skippedSeen++; continue; }
      todo.push(id);
    }
    if (!todo.length) return stats;

    log.info(`Full vacancies to fetch: ${todo.length} (cached ${stats.cached}, seen skipped ${stats.skippedSeen})`);
    onProgress?.({ type: 'start', total: todo.length, cached: stats.cached, skippedSeen: stats.skippedSeen });

    const byId = new Map<string, any>(entries.map(item => [String(item.id), item]));
    for (const id of todo) {
      try {
        const full = await this.source.getVacancy(id);
        if (!full) {
          log.warn(`Empty vacancy ${id}, skipping`);
          stats.failed++;
          stats.failedIds.push(id);
        } else {
          await this.cache.saveFull(full);
          stats.saved++;
        }
      } catch (err) {
        log.warn(`Failed to fetch vacancy ${id}: ${err.message}`);
        stats.failed++;
        stats.failedIds.push(id);
      }

      const done = stats.saved + stats.failed;
      if (done % 10 === 0 || done === todo.length) {
        const name = byId.get(id)?.name || id;
        onProgress?.({ type: 'progress', done, total: todo.length, name });
        log.info(`Full cards: ${done}/${todo.length}`);
      }
    }
    return stats;
  }
}
