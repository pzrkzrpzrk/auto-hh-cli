// Стадии подготовки писем по дайджесту. Каждая — один шаг прежнего coverDigest,
// с тем же порядком и текстами логов; I/O идёт через порты.
import log from "../../shared/logger.js";
import { buildCoverLettersBatch } from "../../domain/cover-letter/index.js";
import type { DigestEntry, Vacancy } from "../../domain/models.js";
import { AllVacanciesPolicy } from "../search/FullCardPolicy.js";
import SearchCache from "../search/SearchCache.js";
import { VacancyCollector } from "../search/VacancyCollector.js";
import { CoverStage, type StageResult } from "./CoverStage.js";
import { CoverPlan, CoverProgress } from "./CoverPlan.js";
import type { CoverContext } from "./CoverContext.js";

/** 1. Последний дайджест; пусто — конвейер останавливается с исходом empty. */
export class LoadDigestStage extends CoverStage {
  readonly name = 'load-digest';

  protected async execute(ctx: CoverContext): Promise<StageResult> {
    ctx.digest = await ctx.deps.digests.latest().catch(() => null);
    if (!ctx.digest || !ctx.digest.entries.length) {
      log.warn('Дайджест пуст — сначала соберите его: пункт меню «🧠 Собрать дайджест» (нужна MongoDB)');
      ctx.outcome = 'empty';
      return 'stop';
    }
    return 'continue';
  }
}

/** 2. Лимит `--limit` (0 или не задан — весь дайджест): команда печатает только этот срез. */
export class LimitStage extends CoverStage {
  readonly name = 'limit';

  protected async execute(ctx: CoverContext): Promise<StageResult> {
    const all = ctx.digest!.entries;
    const limit = Number(ctx.opts.limit) > 0 ? Number(ctx.opts.limit) : all.length;
    ctx.entries = all.slice(0, limit);
    return 'continue';
  }
}

/** 3. Письма из кэша (с учётом force) и счётчики плана; все готовы — конвейер стоп. */
export class AttachLettersStage extends CoverStage {
  readonly name = 'attach-letters';

  protected async execute(ctx: CoverContext): Promise<StageResult> {
    // Ошибка кэша не должна отменять генерацию: работаем с исходными записями.
    const withLetters = await ctx.deps.letters.attach(ctx.entries, { force: Boolean(ctx.opts.force) })
      .catch(() => ctx.entries);
    for (const entry of withLetters) {
      if (entry.coverLetter) ctx.letters.set(String(entry.id), entry.coverLetter);
    }

    ctx.pending = withLetters.filter(entry => !entry.coverLetter);
    const plan = new CoverPlan(ctx.entries.length, ctx.pending.length);
    log.info(plan.toString());
    // Генерировать нечего — сразу отдаём готовые письма команде.
    return plan.pending ? 'continue' : 'stop';
  }
}

/** 4. Описания вакансий: сначала cacheFull, недостающие — со страницы hh.ru. */
export class EnsureCardsStage extends CoverStage {
  readonly name = 'ensure-cards';

  protected async execute(ctx: CoverContext): Promise<StageResult> {
    ctx.fullById = await ctx.deps.collect.cacheStore.getFullByVacancyIds(ctx.pending.map(entry => entry.id))
      .catch(() => ({} as Record<string, Vacancy>));
    const missing = ctx.pending.filter(entry => !ctx.fullById[String(entry.id)]).map(entry => String(entry.id));
    if (!missing.length) return 'continue';

    log.info(`Подгружаю описания вакансий: ${missing.length}`);
    // Общая догрузка карточек (та же, что в search/digest): письма пишем всем.
    await ctx.deps.source.withSource(async source => {
      const cache = new SearchCache({ date: '', pages: {}, fullById: ctx.fullById }, ctx.deps.collect.cacheStore);
      await new VacancyCollector(source, cache, ctx.deps.collect.history)
        .ensureFullCards(missing, AllVacanciesPolicy);
    });
    return 'continue';
  }
}

/** 5. Вход генератора: пары «вакансия» для записей, у которых есть описание. */
export class SelectItemsStage extends CoverStage {
  readonly name = 'select-items';

  protected async execute(ctx: CoverContext): Promise<StageResult> {
    ctx.items = ctx.pending
      .filter(entry => ctx.fullById[String(entry.id)])
      .map(entry => ({ vacancy: ctx.fullById[String(entry.id)] }));
    if (ctx.items.length) return 'continue';

    log.warn('Нет описаний вакансий — письма не сгенерированы');
    ctx.outcome = 'empty';
    return 'stop';
  }
}

/** 6. Генерация пачками: каждое готовое письмо сразу уходит в cacheCoverLetters. */
export class GenerateLettersStage extends CoverStage {
  readonly name = 'generate-letters';

  protected async execute(ctx: CoverContext): Promise<StageResult> {
    const batchSize = ctx.cfg.batchSize;
    log.info(`Генерация писем пачками по ${batchSize} для ${ctx.items.length} вакансий`);
    const generated = await buildCoverLettersBatch(
      ctx.ai,
      ctx.resume,
      ctx.items,
      batchSize,
      async partial => {
        for (const [id, letter] of partial.entries()) {
          ctx.letters.set(id, letter);
          // Частичное сохранение: прерванный прогон не теряет готовые письма.
          await ctx.deps.letters.save(id, letter)
            .catch(err => log.warn(`saveLetter ${id}: ${err.message}`));
        }
      },
      ctx.cfg.adaptResume,
      {
        profile: ctx.cfg.profile,
        signature: ctx.cfg.signature,
        concurrency: ctx.cfg.concurrency,
        logger: log,
      },
    );
    for (const [id, letter] of generated.entries()) ctx.letters.set(id, letter);
    return 'continue';
  }
}

/** 7. Обновление дайджеста (все записи, не только лимит) и счётчик готовых писем. */
export class PersistDigestStage extends CoverStage {
  readonly name = 'persist-digest';

  protected async execute(ctx: CoverContext): Promise<StageResult> {
    const digest = ctx.digest!;
    const updated: DigestEntry[] = digest.entries.map(entry => ({
      ...entry,
      coverLetter: ctx.letters.get(String(entry.id)) || entry.coverLetter || '',
    }));

    const progress = new CoverProgress(updated.filter(entry => entry.coverLetter).length, updated.length);
    log.info(progress.toString());
    if (!progress.hasReady) return 'continue';

    // Ошибка записи не отменяет уже сгенерированные письма: они в cacheCoverLetters.
    const files = await ctx.deps.digests.save('digest', updated, digest.date)
      .catch(err => { log.warn(`Не удалось обновить дайджест: ${err.message}`); return null; });
    if (files?.length) log.info(`Digest updated with cover letters: ${files.join(', ')}`);
    return 'continue';
  }
}

