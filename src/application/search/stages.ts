// Фазы поиска (Chain of Responsibility): страницы выдачи → файл → полные карточки.
// Ошибки файла и карточек не валят поиск — данные уже в кэше; страницы валят (как раньше).
import type { SearchEntry } from "../../domain/models.js";
import { fmtSalary } from "../collect.js";
import { SkipSeenPolicy } from "./FullCardPolicy.js";
import { SearchStage, type StageResult } from "./SearchStage.js";
import type { SearchContext } from "./SearchContext.js";
import log from "../../shared/logger.js";

// Единый литерал строки выдачи для файла — те же поля, что у элемента cachePages
// (id/name/employer/area/salary/alternate_url), см. mapSearchItem в infrastructure/hh/client.ts.
function toSearchEntry(item: any): SearchEntry {
  return {
    id: String(item.id),
    title: item.name || '—',
    employer: item.employer?.name || '—',
    area: item.area?.name || '—',
    salary: fmtSalary(item.salary),
    url: item.alternate_url || `https://hh.ru/vacancy/${item.id}`,
  };
}

/** Страницы выдачи hh.ru: кэш → источник, с сохранением в cachePages. */
export class CollectPagesStage extends SearchStage {
  readonly name = 'collect-pages';

  protected async execute(ctx: SearchContext): Promise<StageResult> {
    ctx.items = await ctx.collector.collectPages(ctx.query);
    ctx.report({ type: 'found', items: ctx.items });

    log.info(`Search done: ${ctx.items.length} vacancies collected (cached)`);
    if (!ctx.items.length) {
      ctx.report({ type: 'nothing-found' });
      ctx.stopped = true;
      return 'stop';
    }
    return 'continue';
  }
}

/** Выдача в файл (data/search/): дописываются только новые вакансии, дедуп по id. */
export class ExportSearchFileStage extends SearchStage {
  readonly name = 'export-results';

  protected enabled(ctx: SearchContext): boolean {
    return ctx.items.length > 0;
  }

  protected async execute(ctx: SearchContext): Promise<StageResult> {
    const rows = ctx.cache.flatten().map(toSearchEntry);
    const results = await ctx.writer.write(rows, { query: ctx.cfg.search.text });
    const added = results.reduce((n, r) => n + r.added, 0);
    const total = results.reduce((n, r) => n + r.total, 0);
    if (added > 0) {
      log.info(`Search results saved: ${results.length} regions, +${added} new, total ${total}`);
      ctx.report({ type: 'files-saved', results, added, total });
    } else if (results.length) {
      log.info(`Search results unchanged: ${results.length} regions, ${total} vacancies, no new`);
      ctx.report({ type: 'files-unchanged', results, total });
    } else {
      log.info('Search results: no vacancies to save');
    }
    return 'continue';
  }

  // Ошибка записи не должна выглядеть как провал поиска: данные уже в Mongo, только логируем.
  protected onError(err: any, ctx: SearchContext): StageResult {
    log.error(`Search file dump failed: ${err.message}`);
    ctx.report({ type: 'files-failed', message: err.message });
    return 'continue';
  }
}

/** Полные карточки (cacheFull): нужны шагам digest и cover — забираем сразу. */
export class CollectFullCardsStage extends SearchStage {
  readonly name = 'collect-full-cards';

  protected enabled(ctx: SearchContext): boolean {
    return ctx.items.length > 0;
  }

  protected async execute(ctx: SearchContext): Promise<StageResult> {
    const full = await ctx.collector.ensureFullCards(ctx.items, SkipSeenPolicy, progress => {
      if (progress.type === 'start') {
        ctx.report({ type: 'full-start', total: progress.total, cached: progress.cached, skippedSeen: progress.skippedSeen });
      } else {
        ctx.report({ type: 'full-progress', done: progress.done, total: progress.total, name: progress.name });
      }
    });
    ctx.report({ type: 'full-cards', summary: full });
    return 'continue';
  }

  // Страницы выдачи уже в кэше: падение на карточках не должно выглядеть как провал поиска.
  protected onError(err: any, ctx: SearchContext): StageResult {
    log.error(`Full vacancies failed: ${err.message}`);
    ctx.report({ type: 'full-cards-failed', message: err.message });
    return 'continue';
  }
}
