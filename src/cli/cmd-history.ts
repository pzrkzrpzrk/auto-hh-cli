// Команда history: история откликов из MongoDB (коллекция history).
import history from "../store/history-store.js";
import log from "../logger.js";

// Последние n записей по времени: Mongo не гарантирует порядок документов,
// а slice(-n) должен отдавать самые свежие.
function lastByAt<T>(items: [string, T][], n: number, at: (item: T) => string): [string, T][] {
  return [...items]
    .sort((a, b) => String(at(a[1])).localeCompare(String(at(b[1]))))
    .slice(-n);
}

async function cmdHistory(opts: Record<string, any> = {}) {
  const state = await history.load().catch(err => {
    log.error(`Не удалось прочитать историю откликов из MongoDB: ${err.message}`);
    return null;
  });
  if (!state) {
    process.exitCode = 1;
    return;
  }

  const appliedAll = Object.entries(state.applied);
  const seenOnlyAll = Object.entries(state.seen).filter(([id]) => !state.applied[id]);
  const total = Object.keys(state.seen).length;

  if (!total) {
    log.info('No history yet.');
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({ applied: state.applied, seenOnly: Object.fromEntries(seenOnlyAll) }, null, 2));
    return;
  }

  const applied = lastByAt(appliedAll, 20, (m: any) => m.at);
  const seen = lastByAt(seenOnlyAll, 10, at => String(at));

  console.log(`\n=== История откликов: откликнулся ${appliedAll.length}, просмотрено без отклика ${seenOnlyAll.length}, всего ${total} ===`);

  if (applied.length) {
    console.log(`\n=== Откликнулся (${appliedAll.length}) ===`);
    for (const [id, meta] of applied) {
      const m = meta as Record<string, any>;
      console.log(`  ${m.title || id} @ ${m.employer || '?'} [${m.score ?? '?'}/10]`);
      console.log(`    ${m.url || ''}`);
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
