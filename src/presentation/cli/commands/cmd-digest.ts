// Команда digest: тонкая оболочка над сценарием application/digest.ts.
// Здесь только выбор действия и печать; фильтр, ИИ-судья и запись — в сценарии.
import fs from "fs";
import path from "path";
import { aiProvider, collectDeps } from "../../../composition.js";
import { buildDigest, actualizeDigests } from "../../../application/digest.js";
import { getLatestDigest } from "../../../infrastructure/mongo/digest-store.js";
import * as collectCache from "../../../infrastructure/mongo/cache-store.js";
import { DIGEST_DIR } from "../../../infrastructure/config/paths.js";
import type { DigestEntry } from "../../../domain/models.js";
import log from "../../../shared/logger.js";

function printTop(matched: DigestEntry[]) {
  if (!matched.length) return;
  console.log('\n=== TOP MATCHES ===');
  for (const e of matched.slice(0, 10)) {
    const when = e.publishedAt ? ` | опубликована ${String(e.publishedAt).slice(0, 10)}` : '';
    console.log(`- [${e.score ?? '?'}/10] ${e.title} @ ${e.employer} | ${e.salary}${when}\n  ${e.url}`);
  }
}

// Шаг digest: сценарий собирает дайджест, команда печатает топ и подсказку про письма.
async function build(opts: Record<string, any> = {}) {
  const result = await buildDigest(opts, { ai: () => aiProvider(), collect: collectDeps }, printTop);
  if (!result) return;
  if (!result.dryRun && result.matched.length) {
    console.log('\nДальше: пункт меню «✉️ Письма для дайджеста» — сгенерировать сопроводительные');
  }
}

// Fallback-поиск дайджестов на диске, когда Mongo недоступна:
// новая раскладка — <dir>/<date>/<region>/digest.md (берём самую свежую дату, все регионы),
// legacy <dir>/digest-<date>.md — как запасной вариант (только самый свежий файл).
function listDigestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const dateDirs = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map(e => e.name)
    .sort()
    .reverse();
  if (dateDirs.length) {
    const latest = path.join(dir, dateDirs[0]);
    return fs.readdirSync(latest, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(latest, e.name, 'digest.md'))
      .filter(p => fs.existsSync(p))
      .sort();
  }
  const legacy = fs.readdirSync(dir).filter(f => /^digest-.*\.md$/.test(f)).sort().reverse();
  return legacy.length ? [path.join(dir, legacy[0])] : [];
}

// Шаг показа: последний дайджест + письма из кэша (fallback — .md файл).
async function show(opts: Record<string, any> = {}) {
  const digest = await getLatestDigest().catch(() => null);
  if (digest) {
    const entries = await collectCache.withCoverLetters<DigestEntry>(digest.entries);
    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      console.log(`\n=== Дайджест ${digest.date} (${entries.length} вакансий) ===\n`);
      for (const e of entries) {
        console.log(`[${e.score ?? '?'}/10] ${e.title} @ ${e.employer}`);
        console.log(`      ${e.salary || '—'} | ${e.area || '—'}`);
        if (e.publishedAt) console.log(`      Опубликована: ${String(e.publishedAt).slice(0, 10)}`);
        console.log(`      ${e.url}`);
        if (e.coverLetter) console.log(`      -> письмо: ${e.coverLetter.slice(0, 80)}...`);
        console.log();
      }
    }
    return;
  }

  const files = listDigestFiles(DIGEST_DIR);
  if (!files.length) {
    log.info('No digest found. Сначала соберите дайджест: пункт меню «🧠 Собрать дайджест»');
    return;
  }
  for (const f of files) console.log(fs.readFileSync(f, 'utf-8'));
}

// Шаг актуализации: сценарий обновляет записи, команда печатает итоги.
async function actualize(opts: Record<string, any> = {}) {
  const result = await actualizeDigests(opts);
  if (!result) return;

  console.log(`\nАктуализация (поиск от ${result.today}): проверено ${result.checkedTotal} вакансий, помечено недоступными ${result.markedTotal}${result.dryRun ? ' [dry-run]' : ''}`);
  if (result.snapshots.length && !result.dryRun) {
    console.log(`Сводные снимки актуальных вакансий: ${result.snapshots.join(', ')}`);
  }
  if (result.markedTotal && !result.dryRun) {
    console.log('Недоступные вакансии не берутся в отклики (пункт «🚀 Отклики из дайджеста»).');
  }
}

const SHOW_ACTIONS = new Set(['show', 'last', 'latest', 'view']);
const ACTUALIZE_ACTIONS = new Set(['actualize', 'actualise', 'refresh', 'sync']);

export default async function cmdDigest(action: any = 'build', opts: Record<string, any> = {}) {
  // Совместимость с прежним вызовом cmdDigest({ json: true }) — это показ дайджеста.
  if (action && typeof action === 'object') {
    opts = action;
    action = 'show';
  }

  const name = String(action).toLowerCase();
  if (SHOW_ACTIONS.has(name)) return show(opts);
  if (ACTUALIZE_ACTIONS.has(name)) return actualize(opts);
  if (name === 'build' || name === 'make' || name === 'create') return build(opts);

  console.error(`Неизвестное действие "digest ${action}". Доступно: build (по умолчанию), show, actualize.`);
  process.exitCode = 1;
}
