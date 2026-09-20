// Команда digest: отдельный шаг сборки дайджеста (локальный фильтр + ИИ-судья) и показ последнего.
// Вход — кэш поиска (`auto-hh search`), сопроводительные — отдельный шаг (`auto-hh cover`).
import fs from "fs";
import path from "path";
import HHClient from "../clients/hh-client";
import { loadConfig } from "../config.js";
import history from "../store/history-store";
import * as collectCache from "../store/cache-store.js";
import { vacancyMatchesFilter } from "../domain/filter.js";
import { loadResume } from "../resume.js";
import { judgeVacancy, judgeVacanciesBatch } from "../domain/judge";
import { writeDigest, writeRejected, getLatestDigest } from "../store/digest-store";
import { registerResume } from "../store/resume-store.js";
import { flattenCollected, fmtSalary } from "../domain/collect.js";
import log from "../logger.js";

// Дата кэша поиска: тем же ключом пишутся полные вакансии и вердикты ИИ.
function sessionDate(cache) {
  return cache.date ? new Date(`${cache.date}T00:00:00.000Z`) : undefined;
}

async function filterLocally(client, items, cache, cfg, markSeen = true) {
  const candidates = [];
  const date = sessionDate(cache);
  for (const item of items) {
    let full = cache.fullById[String(item.id)];
    if (!full) {
      if (await history.isSeen(item.id)) continue;
      try {
        full = await client.getVacancy(item.id);
      } catch (err) {
        log.warn(`Failed to fetch vacancy ${item.id}: ${err.message}`);
        if (markSeen) await history.markSeen(item.id);
        continue;
      }
      if (!full) {
        log.warn(`Empty vacancy ${item.id}, skipping`);
        if (markSeen) await history.markSeen(item.id);
        continue;
      }
      cache.fullById[String(item.id)] = full;
      await collectCache.saveFullVacancy(full, date);
    }

    const verdict = vacancyMatchesFilter(full, cfg.filter);
    // В dry-run историю не трогаем: прогон не должен оставлять следов.
    if (markSeen) await history.markSeen(item.id);
    if (!verdict.ok) {
      log.info(`Skip ${item.id} (${full.name}): ${verdict.reason}`);
      continue;
    }
    candidates.push({ full, verdict });
  }
  return candidates;
}

async function judgeWithClaude(resume, candidates, cache, minScore, adaptResume = false, resumeId?: string) {
  const judgements = new Map();
  for (const [id, j] of Object.entries(cache.judgements)) judgements.set(id, j);
  let judgedCount = 0;

  const pending = candidates.filter(c => !judgements.has(String(c.full.id)));
  if (pending.length < candidates.length) {
    log.info(`Judgements from cache: ${candidates.length - pending.length}/${candidates.length}`);
  }

  const batchSize = parseInt(process.env.JUDGE_BATCH_SIZE || '10', 10);
  const date = sessionDate(cache);
  const batches = [];
  for (let i = 0; i < pending.length; i += batchSize) {
    batches.push(pending.slice(i, i + batchSize).map(c => c.full));
  }

  let nextBatchIdx = 0;
  const CONCURRENCY = 10;

  async function runBatch(idx, batch) {
    log.info(`Judging batch ${idx}: ${batch.length} vacancies`);
    const result = await judgeVacanciesBatch(resume, batch, { minScore, adaptResume });
    if (!result) {
      log.warn(`Batch ${idx} failed, falling back to per-item judge`);
      for (const v of batch) {
        const j = await judgeVacancy(resume, v, { minScore, adaptResume });
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

  async function worker() {
    while (nextBatchIdx < batches.length) {
      const batch = batches[nextBatchIdx];
      const num = nextBatchIdx + 1;
      nextBatchIdx++;
      await runBatch(num, batch);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));
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

function printTop(matched) {
  if (!matched.length) return;
  console.log('\n=== TOP MATCHES ===');
  for (const e of matched.slice(0, 10)) {
    console.log(`- [${e.score ?? '?'}/10] ${e.title} @ ${e.employer} | ${e.salary}\n  ${e.url}`);
  }
}

// Шаг digest: кэш поиска → локальный фильтр → ИИ-судья → digest/rejected (файлы + Mongo).
async function build(opts: Record<string, any> = {}) {
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
    log.warn('Кэш поиска пуст — сначала выполните: auto-hh search');
    return;
  }

  const items = flattenCollected(cache);
  if (!items.length) {
    log.info(`Поиск от ${cache.date} не вернул вакансий — проверьте config.search.`);
    return;
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
    const candidates = await filterLocally(client, items, cache, cfg, !dryRun);
    log.info(`Local filter passed: ${candidates.length}/${items.length}`);

    const adaptResume = cfg.adaptResume !== false;
    const { judgements, judgedCount } = useClaude
      ? await judgeWithClaude(resume, candidates, cache, minScore, adaptResume, resumeId)
      : { judgements: new Map(), judgedCount: 0 };

    const { accepted, rejected } = selectAccepted(candidates, judgements, useClaude, maxRun);
    const matched = await buildResults(accepted, !dryRun);

    log.info(`Judged by Claude: ${judgedCount}, accepted: ${matched.length}, rejected: ${rejected.length}`);
    printTop(matched);

    if (dryRun) {
      log.warn('Dry-run: история, дайджест и rejected не изменялись');
      return;
    }

    const rejectedFile = await writeRejected(rejected);
    if (rejectedFile) log.info(`Rejected saved: ${rejectedFile} (${rejected.length} vacancies)`);

    if (!matched.length) {
      log.info('No matching vacancies.');
      return;
    }

    const file = await writeDigest(matched);
    log.info(`Digest saved: ${file} (${matched.length} vacancies)`);
    console.log('\nДальше: auto-hh cover — сгенерировать сопроводительные');
  } finally {
    await client.close?.();
  }
}

// Шаг показа: последний дайджест + письма из кэша (fallback — .md файл).
async function show(opts: Record<string, any> = {}) {
  const digest = await getLatestDigest().catch(() => null);
  if (digest) {
    const letters = await collectCache.getLettersByVacancyIds(digest.entries.map(e => e.id)).catch(() => ({}));
    const entries = digest.entries.map(e => ({ ...e, coverLetter: letters[String(e.id)] || e.coverLetter || '' }));
    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      console.log(`\n=== Дайджест ${digest.date} (${entries.length} вакансий) ===\n`);
      for (const e of entries) {
        console.log(`[${e.score ?? '?'}/10] ${e.title} @ ${e.employer}`);
        console.log(`      ${e.salary || '—'} | ${e.area || '—'}`);
        console.log(`      ${e.url}`);
        if (e.coverLetter) console.log(`      -> письмо: ${e.coverLetter.slice(0, 80)}...`);
        console.log();
      }
    }
    return;
  }

  const dir = path.join(__dirname, '..', '..', 'data');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => /^digest-.*\.md$/.test(f)).sort().reverse()
    : [];
  if (!files.length) {
    log.info('No digest found. Сначала соберите дайджест: auto-hh digest');
    return;
  }
  console.log(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
}

const SHOW_ACTIONS = new Set(['show', 'last', 'latest', 'view']);

export default async function cmdDigest(action: any = 'build', opts: Record<string, any> = {}) {
  // Совместимость с прежним вызовом cmdDigest({ json: true }) — это показ дайджеста.
  if (action && typeof action === 'object') {
    opts = action;
    action = 'show';
  }

  const name = String(action).toLowerCase();
  if (SHOW_ACTIONS.has(name)) return show(opts);
  if (name === 'build' || name === 'make' || name === 'create') return build(opts);

  console.error(`Неизвестное действие "digest ${action}". Доступно: build (по умолчанию), show.`);
  process.exitCode = 1;
}

export { build as buildDigest, show as showDigest };
