// Сценарий истории откликов: чтение состояния из MongoDB и выборки для показа.
// Печать (включая --json) — в команде: здесь только данные и ошибка чтения.
import history from "../infrastructure/mongo/history-store.js";

// Последние n записей по времени: Mongo не гарантирует порядок документов,
// а slice(-n) должен отдавать самые свежие.
function lastByAt<T>(items: [string, T][], n: number, at: (item: T) => string): [string, T][] {
  return [...items]
    .sort((a, b) => String(at(a[1])).localeCompare(String(at(b[1]))))
    .slice(-n);
}

export interface HistorySnapshot {
  /** Отклики целиком — для `--json`. */
  appliedMap: Record<string, any>;
  /** Сколько всего откликов. */
  appliedTotal: number;
  /** Последние 20 откликов. */
  applied: [string, any][];
  /** Все просмотренные без отклика — для счётчика и `--json`. */
  seenOnlyAll: [string, any][];
  /** Последние 10 просмотренных без отклика. */
  seen: [string, any][];
  /** Сколько всего вакансий в истории (просмотренные + отклики). */
  total: number;
}

export type HistoryOutcome =
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ok'; snapshot: HistorySnapshot };

export async function loadHistoryView(): Promise<HistoryOutcome> {
  let state;
  try {
    state = await history.load();
  } catch (err: any) {
    return { kind: 'error', message: err.message };
  }

  const appliedAll = Object.entries(state.applied);
  const seenOnlyAll = Object.entries(state.seen).filter(([id]) => !state.applied[id]);
  const total = Object.keys(state.seen).length;

  if (!total) return { kind: 'empty' };

  const applied = lastByAt(appliedAll, 20, (m: any) => m.at);
  const seen = lastByAt(seenOnlyAll, 10, at => String(at));

  return {
    kind: 'ok',
    snapshot: { appliedMap: state.applied, appliedTotal: appliedAll.length, applied, seen, seenOnlyAll, total },
  };
}
