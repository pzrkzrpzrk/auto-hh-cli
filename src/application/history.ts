// Сценарий истории откликов: чтение состояния через порт HistoryStore и выборки для показа.
// Печать (включая --json) — в команде: здесь только данные и ошибка чтения.
import type { HistoryStore } from "@/domain/ports.js";
import type { ResumeRegistry } from "@/domain/digest/ports.js";

export interface HistoryDeps {
  history: HistoryStore;
  /** Реестр резюме: превращает resumeId из meta в человекочитаемое имя. */
  resumes: ResumeRegistry;
}

// Последние n записей по времени: Порядок строк не гарантирован,
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
  /** resumeId → «имя (файл)» из реестра; отсутствующие id показываются как есть. */
  resumeLabels: Record<string, string>;
}

export type HistoryOutcome =
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ok'; snapshot: HistorySnapshot };

export async function loadHistoryView(deps: HistoryDeps): Promise<HistoryOutcome> {
  let state;
  try {
    state = await deps.history.load();
  } catch (err: any) {
    return { kind: 'error', message: err.message };
  }

  const appliedAll = Object.entries(state.applied);
  const seenOnlyAll = Object.entries(state.seen).filter(([id]) => !state.applied[id]);
  const total = Object.keys(state.seen).length;

  if (!total) return { kind: 'empty' };

  const applied = lastByAt(appliedAll, 20, (m: any) => m.at);
  const seen = lastByAt(seenOnlyAll, 10, at => String(at));
  const resumeLabels = await loadResumeLabels(state.applied, deps);

  return {
    kind: 'ok',
    snapshot: {
      appliedMap: state.applied,
      appliedTotal: appliedAll.length,
      applied,
      seen,
      seenOnlyAll,
      total,
      resumeLabels,
    },
  };
}

/** join «resumeId → имя (файл)»: ошибка реестра не мешает показать историю. */
async function loadResumeLabels(
  applied: Record<string, any>,
  deps: HistoryDeps,
): Promise<Record<string, string>> {
  const ids = [...new Set(
    Object.values(applied)
      .map(meta => (meta as any)?.resumeId)
      .filter((id): id is string => typeof id === 'string' && Boolean(id)),
  )];
  if (!ids.length) return {};

  const labels: Record<string, string> = {};
  try {
    const registered = await deps.resumes.listRegistered();
    const byId = new Map(registered.map(r => [r.resumeId, r]));
    for (const id of ids) {
      const found = byId.get(id);
      labels[id] = found ? `${found.name} (${found.filename})` : id;
    }
  } catch {
    for (const id of ids) labels[id] = id;
  }
  return labels;
}
