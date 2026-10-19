// Сценарий сборки и актуализации дайджеста.
// Оркестрация: кэш поиска → локальный фильтр → ИИ-судья → digest/rejected (файлы + Mongo).
// Вывод в консоль остаётся в команде: сценарий отдаёт данные и колбэк onMatched.
import HHClient from "../infrastructure/hh/client.js";
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
} from "../infrastructure/mongo/digest-store.js";
import { computeActualization, mergeActualized } from "../domain/actualize.js";
import { registerResume } from "../infrastructure/mongo/resume-store.js";
import type { DigestEntry } from "../domain/models.js";
import { flattenCollected, fmtSalary, ensureFullVacancies } from "./collect.js";
import type { AiProvider, CollectDeps } from "../domain/ports.js";
import { intFromEnv } from "../infrastructure/config/env.js";
import log from "../shared/logger.js";

/** Зависимости сценария: конкретные реализации подставляет команда (composition root). */
export interface DigestDeps {
  /** Провайдер ИИ создаётся лениво — ровно там, где он нужен (как раньше). */
  ai: () => AiProvider | null;
  collect: CollectDeps;
}

// Дата кэша поиска: тем же ключом пишутся полные вакансии и вердикты ИИ.
function sessionDate(cache) {
  return cache.date ? new Date(`${cache.date}T00:00:00.000Z`) : undefined;
}

async function filterLocally(client, items, cache, cfg, deps: CollectDeps, markSeen = true) {
  // Догрузка карточек — общая с шагами search и cover. Просмотренные не качаем: ниже они всё равно пропускаются.
  const { failedIds } = await ensureFullVacancies(client, items, cache, deps, { skipSeen: true });
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

function selectAccepted(candidates, judgements, useClaude, maxRun) {
  const accepted = [];
  const rejected = [];
  for (const { full, verdict } of candidates) {
    if (accepted.length >= maxRun) break;

    let score = null, reason = '', comment = null;

    if (useClaude) {
      const judgement = judgements.get(String(full.id));
      if (!judgement) {
        log.warn(`No judgement for ${full.id}, falling back to template`);
      } else {
        score = judgement.score;
        reason = judgement.reason;
        comment = judgement.comment;
        if (!judgement.fit) {
          log.info(`Claude rejected ${full.id} (score=${score}): ${reason}`);
          rejected.push({
            id: full.id,
            title: full.name,
            employer: full.employer?.name || '—',
            area: full.area?.name || '—',
            salary: fmtSalary(full.salary),
            url: full.alternate_url,
            publishedAt: full.publishedAt || null,
            score,
            reason,
          });
          continue;
        }
        log.info(`Claude approved ${full.id} (score=${score}): ${comment || reason}`);
      }
    }

    accepted.push({ full, verdict, score, reason, comment });
  }
  return { accepted, rejected };
}

// Записи дайджеста без писем: письма добавляются отдельным шагом cover.
// track=false (dry-run) — не трогаем историю откликов.
async function buildResults(accepted, track = true) {
  const matched = [];
  for (const a of accepted) {
    const { full, score, reason, comment } = a;
    matched.push({
      id: full.id,
      title: full.name,
      employer: full.employer?.name || '—',
      area: full.area?.name || '—',
      salary: fmtSalary(full.salary),
      url: full.alternate_url,
      publishedAt: full.publishedAt || null,
      score,
      reason,
      comment,
      coverLetter: '',
    });
    if (track) {
      await history.markApplied(full.id, {
        title: full.name,
        employer: full.employer?.name,
        url: full.alternate_url,
        score,
        digestOnly: true,
      });
    }
    log.info(`Match: ${full.name} @ ${full.employer?.name} -> ${full.alternate_url}`);
  }
  return matched;
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
  const minScore = cfg.apply.minClaudeScore ?? 7;
  const maxRun = opts.limit || cfg.apply.maxPerRun || 50;
  const dryRun = opts.dryRun ?? cfg.apply.dryRun ?? false;
  const hasApiKey = cfg.api?.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  const useClaude = Boolean(resume && hasApiKey && opts.claude !== false);

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

  const client = new HHClient();
  try {
    log.info(`Building digest from search cache ${cache.date}: ${items.length} vacancies`);
    const candidates = await filterLocally(client, items, cache, cfg, deps.collect, !dryRun);
    log.info(`Local filter passed: ${candidates.length}/${items.length}`);

    const adaptResume = cfg.adaptResume !== false;
    const ai = deps.ai();
    const { judgements, judgedCount } = useClaude
      ? await judgeWithClaude(ai, resume, candidates, cache, minScore, adaptResume, resumeId)
      : { judgements: new Map(), judgedCount: 0 };

    const { accepted, rejected } = selectAccepted(candidates, judgements, useClaude, maxRun);
    const matched = await buildResults(accepted, !dryRun);

    log.info(`Judged by Claude: ${judgedCount}, accepted: ${matched.length}, rejected: ${rejected.length}`);
    if (onMatched) onMatched(matched);

    if (dryRun) {
      log.warn('Dry-run: история, дайджест и rejected не изменялись');
      return { matched, rejected, dryRun };
    }

    const rejectedFiles = await writeRejected(rejected);
    if (rejectedFiles.length) {
      log.info(`Rejected saved: ${rejectedFiles.length} regions, ${rejected.length} vacancies -> ${rejectedFiles.join(', ')}`);
    }

    if (!matched.length) {
      log.info('No matching vacancies.');
      return { matched, rejected, dryRun };
    }

    const files = await writeDigest(matched);
    log.info(`Digest saved: ${files.length} regions, ${matched.length} vacancies -> ${files.join(', ')}`);
    return { matched, rejected, dryRun };
  } finally {
    await client.close?.();
  }
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


