// Команда history: история откликов из SQLite (коллекция history).
// Чтение и выборки — application/history.ts, здесь только печать.
import { loadHistoryView } from "@/application/history.js";
import { historyDeps } from "@/composition.js";
import log from "@/shared/logger.js";

async function cmdHistory(opts: Record<string, any> = {}) {
  const outcome = await loadHistoryView(historyDeps);

  if (outcome.kind === 'error') {
    log.error(`Не удалось прочитать историю откликов из базы: ${outcome.message}`);
    process.exitCode = 1;
    return;
  }
  if (outcome.kind === 'empty') {
    log.info('No history yet.');
    return;
  }

  const { appliedMap, appliedTotal, applied, seen, seenOnlyAll, total, resumeLabels } = outcome.snapshot;

  if (opts.json) {
    console.log(JSON.stringify({ applied: appliedMap, seenOnly: Object.fromEntries(seenOnlyAll) }, null, 2));
    return;
  }

  console.log(`\n=== История откликов: откликнулся ${appliedTotal}, просмотрено без отклика ${seenOnlyAll.length}, всего ${total} ===`);

  if (applied.length) {
    console.log(`\n=== Откликнулся (${appliedTotal}) ===`);
    for (const [id, meta] of applied) {
      const m = meta as Record<string, any>;
      console.log(`  ${m.title || id} @ ${m.employer || '?'} [${m.score ?? '?'}/10]`);
      console.log(`    ${m.url || ''}`);
      if (m.resumeId) {
        console.log(`    Резюме: ${resumeLabels[m.resumeId] || m.resumeId}`);
      }
    }
  } else {
    console.log('\nНет откликов.');
  }

  if (seen.length) {
    console.log(`\n=== Просмотрено, без отклика (${seenOnlyAll.length}) ===`);
    for (const [id] of seen) {
      console.log(`  ${id}`);
    }
  }
}

export default cmdHistory;
