// Стадии подготовки плана отклика. Каждая — один шаг прежнего runApply,
// с тем же порядком и текстами логов; I/O идёт через порты.
import log from "../../shared/logger.js";
import { ApplyStage, type StageResult } from "./ApplyStage.js";
import type { ApplyContext } from "./ApplyContext.js";

/** 1. Дайджест выбранной стратегией: сегодняшний (latest) или все сохранённые (all). */
export class LoadDigestStage extends ApplyStage {
  readonly name = 'load-digest';

  protected async execute(ctx: ApplyContext): Promise<StageResult> {
    if (ctx.selection.kind === 'all') log.info('Loading all digests');
    ctx.entries = await ctx.selection.load(ctx.deps.digests);
    return 'continue';
  }
}

/** 2. Актуализированные (шаг `digest actualize`) вакансии пропускаем: их уже нет в поиске. */
export class FilterArchivedStage extends ApplyStage {
  readonly name = 'filter-archived';

  protected async execute(ctx: ApplyContext): Promise<StageResult> {
    const loaded = ctx.entries;
    ctx.entries = loaded.filter(entry => !entry.archived);
    if (loaded.length !== ctx.entries.length) {
      log.info(`Недоступных пропущено: ${loaded.length - ctx.entries.length}`);
    }
    return 'continue';
  }
}

/** 3. Лимит `--limit` (0 или не задан — без лимита) и итоговый размер плана. */
export class LimitStage extends ApplyStage {
  readonly name = 'limit';

  protected async execute(ctx: ApplyContext): Promise<StageResult> {
    const limit = ctx.opts.limit;
    if (limit && Number.isFinite(limit) && limit > 0) {
      ctx.entries.splice(limit);
      log.info(`Limit applied: ${limit} vacancies`);
    }
    log.info(`${ctx.entries.length} vacancies in digest`);
    return 'continue';
  }
}

/** 4. Письма из cacheCoverLetters: без письма вакансия будет пропущена исполнителем. */
export class AttachLettersStage extends ApplyStage {
  readonly name = 'attach-letters';

  protected async execute(ctx: ApplyContext): Promise<StageResult> {
    ctx.planned = await ctx.deps.letters.attach(ctx.entries);
    const withoutLetter = ctx.planned.filter(entry => !entry.coverLetter).length;
    if (withoutLetter) {
      log.warn(`${withoutLetter} вакансий без сопроводительного — пропускаю (сгенерируйте: пункт меню «✉️ Письма для дайджеста»)`);
    }
    return 'continue';
  }
}

/** 5. История — один раз на прогон: полная выгрузка на каждой итерации ничего не даёт. */
export class LoadHistoryStage extends ApplyStage {
  readonly name = 'load-history';

  protected async execute(ctx: ApplyContext): Promise<StageResult> {
    ctx.applied = (await ctx.deps.history.load()).applied;
    return 'continue';
  }
}
