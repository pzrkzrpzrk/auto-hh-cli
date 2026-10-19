// Сценарий сборки и актуализации дайджеста.
// Оркестрация: кэш поиска → локальный фильтр → ИИ-судья → digest/rejected (файлы + Mongo).
// Вывод в консоль остаётся в команде: сценарий отдаёт данные и колбэк onMatched.
import { readFileSync } from "fs";
import { chunk, runBatches, aiConcurrencyFromEnv } from "../shared/concurrency.js";
import { loadConfig } from "../infrastructure/config/config.js";
import history from "../infrastructure/mongo/history-store.js";
import * as collectCache from "../infrastructure/mongo/cache-store.js";
import { selectCandidates } from "../domain/filter.js";
import { loadResume } from "../infrastructure/files/resume-loader.js";
import { judgeVacancy, judgeVacanciesBatch } from "../domain/judge/index.js";
import {
  writeDigest,
  writeRejected,
  writeActualDigest,
  writeActualRejected,
  listDigestDocs,
  getLatestDigest,
} from "../infrastructure/mongo/digest-store.js";
import { computeActualization, mergeActualized } from "../domain/actualize.js";
import { registerResume } from "../infrastructure/mongo/resume-store.js";
import { listDigestFiles } from "../infrastructure/files/digest-files.js";
import { DIGEST_DIR } from "../infrastructure/config/paths.js";
import type { DigestEntry } from "../domain/models.js";
import { flattenCollected } from "./collect.js";
import type { AiProvider, CollectDeps, SourceProvider } from "../domain/ports.js";
import type { VacancySource } from "../domain/search/VacancySource.js";
import SearchCache from "./search/SearchCache.js";
import { VacancyCollector } from "./search/VacancyCollector.js";
import { SkipSeenPolicy } from "./search/FullCardPolicy.js";
import { DigestPolicy } from "../domain/digest/DigestPolicy.js";
import { DigestMatcher } from "../domain/digest/DigestMatcher.js";
import { DigestEntryFactory } from "../domain/digest/DigestEntryFactory.js";
import { JudgementSet } from "../domain/digest/JudgementSet.js";
import { intFromEnv } from "../infrastructure/config/env.js";
import log from "../shared/logger.js";

/** Зависимости сценария: конкретные реализации подставляет команда (composition root). */
export interface DigestDeps {
  /** Провайдер ИИ создаётся лениво — ровно там, где он нужен (как раньше). */
  ai: () => AiProvider | null;
  collect: CollectDeps;
  /** Источник вакансий с жизненным циклом (браузер открывается только при догрузке). */
  source: SourceProvider<VacancySource>;
}

// Дата кэша поиска: тем же ключом пишутся полные вакансии и вердикты ИИ.
function sessionDate(cache) {
  return cache.date ? new Date(`${cache.date}T00:00:00.000Z`) : undefined;
}

async function filterLocally(source: VacancySource, items, cache, cfg, deps: CollectDeps, markSeen = true) {
  // Догрузка карточек — общая с шагами search и cover. Просмотренные не качаем: ниже они всё равно пропускаются.
  const collector = new VacancyCollector(source, new SearchCache(cache, deps.cacheStore), deps.history);
  const { failedIds } = await collector.ensureFullCards(items, SkipSeenPolicy);
  // Карточки, которые не удалось скачать, помечаем просмотренными, чтобы не перебирать их при каждом запуске.
  if (markSeen) for (const id of failedIds) await deps.history.markSeen(id);

  // Сам отбор — чистая функция домена; здесь остаётся только I/O (история и лог).
  const { candidates, skipped } = selectCandidates(items, cache, cfg);
  // В dry-run историю не трогаем: прогон не должен оставлять следов.
  if (markSeen) {
    for (const c of candidates) await deps.history.markSeen(c.full.id);
    for (const s of skipped) await deps.history.markSeen(s.id);
  }
  for (const { id, name, reason } of skipped) {
    log.info(`Skip ${id} (${name}): ${reason}`);
  }
  return candidates;
}

async function judgeWithClaude(ai, resume, candidates, cache, minScore, adaptResume = false, resumeId?: string) {
  const judgements = new Map();
  for (const [id, j] of Object.entries(cache.judgements)) judgements.set(id, j);
  let judgedCount = 0;

  const pending = candidates.filter(c => !judgements.has(String(c.full.id)));
  if (pending.length < candidates.length) {
    log.info(`Judgements from cache: ${candidates.length - pending.length}/${candidates.length}`);
  }

  const batchSize = intFromEnv('JUDGE_BATCH_SIZE', 10);
  const date = sessionDate(cache);
  const batches = chunk<any>(pending, batchSize).map(group => group.map(c => c.full));
  const CONCURRENCY = aiConcurrencyFromEnv();

  async function runBatch(idx, batch) {
    log.info(`Judging batch ${idx}: ${batch.length} vacancies`);
    const result = await judgeVacanciesBatch(ai, resume, batch, { minScore, adaptResume });
    if (!result) {
      log.warn(`Batch ${idx} failed, falling back to per-item judge`);
      for (const v of batch) {
        const j = await judgeVacancy(ai, resume, v, { minScore, adaptResume });
        if (j) {
          judgements.set(String(v.id), j);
          cache.judgements[String(v.id)] = j;
          await collectCache.saveJudgements(cache, resumeId, date);
        }
        judgedCount++;
      }
    } else {
      for (const [id, j] of result.entries()) {
        judgements.set(id, j);
        cache.judgements[id] = j;
      }
      await collectCache.saveJudgements(cache, resumeId, date);
      judgedCount += batch.length;
    }
  }

  // Ошибка пачки пробрасывается наверх (как и раньше), а не глушится пулом.
  await runBatches(batches, CONCURRENCY, (batch, index) => runBatch(index + 1, batch), {
    onError: (err) => { throw err; },
  });
  return { judgements, judgedCount };
}

/**
 * Шаг digest: кэш поиска → локальный фильтр → ИИ-судья → digest/rejected (файлы + Mongo).
 * null — собирать нечего (пустой кэш или пустая выдача). onMatched команда использует для печати топа.
 */
export async function buildDigest(
  opts: Record<string, any> = {},
  deps: DigestDeps,
  onMatched?: (matched: DigestEntry[]) => void,
): Promise<{ matched: DigestEntry[]; rejected: any[]; dryRun: boolean } | null> {
  if (opts.config) process.env.CONFIG_PATH = opts.config;

  const cfg = loadConfig();
  const resume = loadResume(opts.resume);
  const resumeId = resume?.id;
  const hasApiKey = cfg.api?.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  // Все флаги прогона — в одном объекте (domain/digest/DigestPolicy.ts).
  const policy = DigestPolicy.from(cfg, opts, {
    hasResume: Boolean(resume),
    hasApiKey: Boolean(hasApiKey),
    judgeBatchSize: intFromEnv('JUDGE_BATCH_SIZE', 10),
    aiConcurrency: aiConcurrencyFromEnv(),
  });

  const cache = await collectCache.loadLatest(resumeId);
  if (!cache) {
    log.warn('Кэш поиска пуст — сначала выполните пункт меню «🔍 Поиск вакансий»');
    return null;
  }

  const items = flattenCollected(cache);
  if (!items.length) {
    log.info(`Поиск от ${cache.date} не вернул вакансий — проверьте config.search.`);
    return null;
  }

  if (resume) {
    log.info(`Resume loaded: ${resumeId} (${resume.filename}, ${resume.type})`);
    await registerResume(resume).catch(() => {});
  } else {
    log.warn('RESUME_PATH not set — Claude judge disabled, fall back to local filter only');
  }

  return await deps.source.withSource(async source => {
    log.info(`Building digest from search cache ${cache.date}: ${items.length} vacancies`);
    const candidates = await filterLocally(source, items, cache, cfg, deps.collect, policy.tracksHistory);
    log.info(`Local filter passed: ${candidates.length}/${items.length}`);

    const ai = deps.ai();
    const { judgements, judgedCount } = policy.useJudge
      ? await judgeWithClaude(ai, resume, candidates, cache, policy.minScore, policy.adaptResume, resumeId)
      : { judgements: new Map(), judgedCount: 0 };

    // Отбор и сборка записей — доменные сервисы: сценарий только связывает их с I/O.
    const judgementSet = JudgementSet.fromSnapshot(Object.fromEntries(judgements));
    const { accepted, rejected } = new DigestMatcher(policy).select(candidates, judgementSet);
    const matched = await new DigestEntryFactory(deps.collect.history).create(accepted, policy.tracksHistory);

    log.info(`Judged by Claude: ${judgedCount}, accepted: ${matched.length}, rejected: ${rejected.length}`);
    if (onMatched) onMatched(matched);

    if (policy.dryRun) {
      log.warn('Dry-run: история, дайджест и rejected не изменялись');
      return { matched, rejected, dryRun: policy.dryRun };
    }

    const rejectedFiles = await writeRejected(rejected);
    if (rejectedFiles.length) {
      log.info(`Rejected saved: ${rejectedFiles.length} regions, ${rejected.length} vacancies -> ${rejectedFiles.join(', ')}`);
    }

    if (!matched.length) {
      log.info('No matching vacancies.');
      return { matched, rejected, dryRun: policy.dryRun };
    }

    const files = await writeDigest(matched);
    log.info(`Digest saved: ${files.length} regions, ${matched.length} vacancies -> ${files.join(', ')}`);
    return { matched, rejected, dryRun: policy.dryRun };
  });
}

// Шаг актуализации: помечает в старых дайджестах/rejected вакансии, которых нет в последнем
// поиске (удалены/скрыты). Ничего не удаляет — обновляет записи и перезаписывает .md по регионам,
// а также пишет сводный снимок по всем прошлым датам в <today>/actual.md.
export interface ActualizeResult {
  today: string;
  checkedTotal: number;
  markedTotal: number;
  snapshots: string[];
  dryRun: boolean;
}

export async function actualizeDigests(opts: Record<string, any> = {}): Promise<ActualizeResult | null> {
  if (opts.config) process.env.CONFIG_PATH = opts.config;
  const cfg = loadConfig();

  const cache = await collectCache.loadLatest().catch(() => null);
  if (!cache) {
    log.warn('Кэш поиска пуст — сначала выполните пункт меню «🔍 Поиск вакансий»');
    return null;
  }
  const today = cache.date;
  const todayIds = new Set(flattenCollected(cache).map(i => String(i.id)));
  const searchPeriod = Number(cfg.search?.search_period) || null;
  log.info(`Актуализация по поиску от ${today}: ${todayIds.size} вакансий в выдаче`);

  const targets: {
    coll: string;
    label: string;
    write: (entries: any[], date?: string) => Promise<string[]>;
    writeActual: (entries: any[], date?: string) => string | null;
  }[] = [
    { coll: 'digest', label: 'digest', write: writeDigest, writeActual: writeActualDigest },
    { coll: 'rejected', label: 'rejected', write: writeRejected, writeActual: writeActualRejected },
  ];

  let checkedTotal = 0;
  let markedTotal = 0;
  const snapshots: string[] = [];
  for (const { coll, label, write, writeActual } of targets) {
    const docs = await listDigestDocs(coll).catch(() => [] as any[]);
    const { docs: updated, stats } = computeActualization(docs, { todayIds, today, searchPeriod });
    checkedTotal += stats.total;
    markedTotal += stats.marked;

    if (!stats.dates) {
      log.info(`${label}: старых дат нет`);
      continue;
    }
    const toWrite = updated.filter(d => d.changed);
    // Сводный снимок по всем прошлым датам (кроме сегодня) — один файл <today>/actual.md.
    const snapshot = mergeActualized(updated);
    if (!opts.dryRun) {
      for (const d of toWrite) await write(d.entries, d.date);
      const actualFile = writeActual(snapshot, today);
      if (actualFile) snapshots.push(actualFile);
    }
    log.info(`${label}: ${stats.dates} дат, ${stats.total} вакансий, недоступно ${stats.marked}, `
      + `обновлено дат ${toWrite.length}${opts.dryRun ? ' (dry-run)' : ''}`);
  }

  return { today, checkedTotal, markedTotal, snapshots, dryRun: Boolean(opts.dryRun) };
}

// Шаг показа: последний дайджест + письма из кэша; fallback — .md файлы на диске.
export type DigestShowOutcome =
  | { kind: 'mongo'; date: string; entries: DigestEntry[] }
  | { kind: 'files'; contents: string[] }
  | { kind: 'none' };

export async function showDigest(opts: Record<string, any> = {}): Promise<DigestShowOutcome> {
  const digest = await getLatestDigest().catch(() => null);
  if (digest) {
    const entries = await collectCache.withCoverLetters<DigestEntry>(digest.entries);
    return { kind: 'mongo', date: digest.date, entries };
  }

  const files = listDigestFiles(DIGEST_DIR);
  if (!files.length) return { kind: 'none' };
  return { kind: 'files', contents: files.map(f => readFileSync(f, 'utf-8')) };
}



