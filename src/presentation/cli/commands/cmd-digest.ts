// Команда digest: тонкая оболочка над сценарием application/digest.ts.
// Здесь только выбор действия и печать; фильтр, ИИ-судья и запись — в сценарии.
import { digestDeps } from "../../../composition.js";
import { buildDigest, actualizeDigests, showDigest } from "../../../application/digest.js";
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
  const result = await buildDigest(opts, digestDeps, printTop);
  if (!result) return;
  if (!result.dryRun && result.matched.length) {
    console.log('\nДальше: пункт меню «✉️ Письма для дайджеста» — сгенерировать сопроводительные');
  }
}

// Шаг показа: последний дайджест + письма из кэша (fallback — .md файл).
async function show(opts: Record<string, any> = {}) {
  const outcome = await showDigest(opts);
  if (outcome.kind === 'none') {
    log.info('No digest found. Сначала соберите дайджест: пункт меню «🧠 Собрать дайджест»');
    return;
  }
  if (outcome.kind === 'files') {
    for (const content of outcome.contents) console.log(content);
    return;
  }

  const { entries } = outcome;
  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(`\n=== Дайджест ${outcome.date} (${entries.length} вакансий) ===\n`);
  for (const e of entries) {
    console.log(`[${e.score ?? '?'}/10] ${e.title} @ ${e.employer}`);
    console.log(`      ${e.salary || '—'} | ${e.area || '—'}`);
    if (e.publishedAt) console.log(`      Опубликована: ${String(e.publishedAt).slice(0, 10)}`);
    console.log(`      ${e.url}`);
    if (e.coverLetter) console.log(`      -> письмо: ${e.coverLetter.slice(0, 80)}...`);
    console.log();
  }
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
