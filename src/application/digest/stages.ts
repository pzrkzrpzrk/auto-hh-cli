// Стадии конвейера дайджеста. Каждая — один шаг прежнего buildDigest,
// с тем же порядком логов; I/O идёт через порты, бизнес-правила — в домене.
import log from "../../shared/logger.js";
import { DigestMatcher } from "../../domain/digest/DigestMatcher.js";
import { DigestEntryFactory } from "../../domain/digest/DigestEntryFactory.js";
import { JudgementSet } from "../../domain/digest/JudgementSet.js";
import type { DigestCacheSnapshot } from "../../domain/digest/types.js";
import { SkipSeenPolicy } from "../search/FullCardPolicy.js";
import SearchCache from "../search/SearchCache.js";
import { VacancyCollector } from "../search/VacancyCollector.js";
import type { DigestContext } from "./DigestContext.js";
import { DigestStage, type StageOutcome } from "./DigestStage.js";
import { JudgementService } from "./JudgementService.js";

// Дата кэша поиска: тем же ключом пишутся полные вакансии и вердикты ИИ.
function sessionDate(snapshot: DigestCacheSnapshot): Date | undefined {
  return snapshot.date ? new Date(`${snapshot.date}T00:00:00.000Z`) : undefined;
}

/** 1. Последний снимок кэша поиска; пусто — конвейер останавливается. */
export class LoadCacheStage extends DigestStage {
  readonly name = 'load-cache';

  protected async execute(ctx: DigestContext): Promise<StageOutcome> {
    const snapshot = await ctx.deps.collect.cacheStore.loadLatest(ctx.resumeId);
    if (!snapshot) {
      log.warn('Кэш поиска пуст — сначала выполните пункт меню «🔍 Поиск вакансий»');
      ctx.outcome = 'cache-empty';
      return 'stop';
    }

    const cache = new SearchCache(snapshot, ctx.deps.collect.cacheStore);
    const items = cache.flatten();
    if (!items.length) {
      log.info(`Поиск от ${snapshot.date} не вернул вакансий — проверьте config.search.`);
      ctx.outcome = 'search-empty';
      return 'stop';
    }

    ctx.snapshot = snapshot;
    ctx.cache = cache;
    ctx.items = items;
    ctx.judgements = JudgementSet.fromSnapshot(snapshot.judgements);
    return 'continue';
  }
}

/** 2. Сообщает, какое резюме судит ИИ; регистрирует его в Mongo (ошибка не критична). */
export class RegisterResumeStage extends DigestStage {
  readonly name = 'register-resume';

  protected async execute(ctx: DigestContext): Promise<StageOutcome> {
    if (!ctx.resume) {
      log.warn('RESUME_PATH not set — Claude judge disabled, fall back to local filter only');
      return 'continue';
    }

    log.info(`Resume loaded: ${ctx.resumeId} (${ctx.resume.filename}, ${ctx.resume.type})`);
    await ctx.deps.resumes.register(ctx.resume).catch(() => {});
    return 'continue';
  }
}

/** 3. Догружает полные карточки; неудачные помечает просмотренными (кроме dry-run). */
export class CollectCardsStage extends DigestStage {
  readonly name = 'collect-cards';

  protected async execute(ctx: DigestContext): Promise<StageOutcome> {
    log.info(`Building digest from search cache ${ctx.cache.date}: ${ctx.items.length} vacancies`);

    const collector = new VacancyCollector(ctx.source, ctx.cache, ctx.deps.collect.history);
    const { failedIds } = await collector.ensureFullCards(ctx.items, SkipSeenPolicy);
    // Карточки, которые не удалось скачать, помечаем просмотренными,
    // чтобы не перебирать их при каждом запуске.
    if (ctx.policy.tracksHistory) {
      for (const id of failedIds) await ctx.deps.collect.history.markSeen(id);
    }
    return 'continue';
  }
}

/** 4. Локальный фильтр (Domain Service) + отметки истории и лог пропусков. */
export class LocalFilterStage extends DigestStage {
  readonly name = 'local-filter';

  protected async execute(ctx: DigestContext): Promise<StageOutcome> {
    const { candidates, skipped } = ctx.filter.select(ctx.items, ctx.cache.raw);

    // В dry-run историю не трогаем: прогон не должен оставлять следов.
    if (ctx.policy.tracksHistory) {
      for (const candidate of candidates) await ctx.deps.collect.history.markSeen(candidate.full.id);
      for (const skip of skipped) await ctx.deps.collect.history.markSeen(skip.id);
    }
    for (const { id, name, reason } of skipped) {
      log.info(`Skip ${id} (${name}): ${reason}`);
    }

    ctx.candidates = candidates;
    log.info(`Local filter passed: ${candidates.length}/${ctx.items.length}`);
    return 'continue';
  }
}

/** 5. ИИ-судья: кэш вердиктов + пачки (сервис судейства). */
export class JudgeStage extends DigestStage {
  readonly name = 'judge';

  protected async execute(ctx: DigestContext): Promise<StageOutcome> {
    if (!ctx.policy.useJudge) return 'continue';

    const { judgedCount } = await new JudgementService(ctx.deps.judgements).judge(
      ctx.deps.ai(ctx.opts.config),
      ctx.resume,
      ctx.candidates,
      ctx.judgements,
      ctx.policy,
      { resumeId: ctx.resumeId, date: sessionDate(ctx.snapshot) },
    );
    ctx.judgedCount = judgedCount;
    return 'continue';
  }
}

/** 6. Отбор принятых/отклонённых и сборка записей дайджеста. */
export class SelectStage extends DigestStage {
  readonly name = 'select';

  protected async execute(ctx: DigestContext): Promise<StageOutcome> {
    const { accepted, rejected } = new DigestMatcher(ctx.policy).select(ctx.candidates, ctx.judgements);
    const matched = await new DigestEntryFactory(ctx.deps.collect.history)
      .create(accepted, ctx.policy.tracksHistory);

    ctx.accepted = accepted;
    ctx.rejected = rejected;
    ctx.matched = matched;

    log.info(`Judged by Claude: ${ctx.judgedCount}, accepted: ${matched.length}, rejected: ${rejected.length}`);
    ctx.report.on({ type: 'matched', matched });
    return 'continue';
  }
}

/** 7. Запись rejected.md и digest.md; dry-run ничего не пишет. */
export class PersistStage extends DigestStage {
  readonly name = 'persist';

  protected async execute(ctx: DigestContext): Promise<StageOutcome> {
    if (ctx.policy.dryRun) {
      log.warn('Dry-run: история, дайджест и rejected не изменялись');
      return 'stop';
    }

    const rejectedFiles = await ctx.deps.digest.save('rejected', ctx.rejected);
    if (rejectedFiles.length) {
      log.info(`Rejected saved: ${rejectedFiles.length} regions, ${ctx.rejected.length} vacancies -> ${rejectedFiles.join(', ')}`);
    }

    if (!ctx.matched.length) {
      log.info('No matching vacancies.');
      return 'stop';
    }

    const files = await ctx.deps.digest.save('digest', ctx.matched);
    log.info(`Digest saved: ${files.length} regions, ${ctx.matched.length} vacancies -> ${files.join(', ')}`);
    ctx.report.on({ type: 'digest-saved', files, count: ctx.matched.length });
    return 'continue';
  }
}

