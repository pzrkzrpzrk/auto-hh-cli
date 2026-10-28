// Хранилище истории откликов в SQLite (таблица history).
import { connect } from "@/infrastructure/sqlite/db.js";
import { fromJson, isoFromMs, toJson } from "@/infrastructure/sqlite/rows.js";
import type { HistoryMeta, HistoryState } from "@/domain/ports.js";

interface HistoryRow {
  vacancy_id: unknown;
  status: unknown;
  at: unknown;
  meta: unknown;
}

function allRows(): HistoryRow[] {
  return connect().prepare('SELECT vacancy_id, status, at, meta FROM history').all() as unknown as HistoryRow[];
}

export async function load(): Promise<HistoryState> {
  const applied: Record<string, HistoryMeta> = {};
  const seen: Record<string, string> = {};
  for (const row of allRows()) {
    const id = String(row.vacancy_id);
    const at = isoFromMs(row.at);
    // meta несёт title/employer/url/score (пишут digest и apply) — без него `history`
    // печатает только id, а `apply` не отличает digest-only отметку от реального отклика.
    if (row.status === 'applied') applied[id] = { ...fromJson<HistoryMeta>(row.meta, {}), at };
    seen[id] = at;
  }
  return { applied, seen };
}

export async function markApplied(vacancyId: string, meta: HistoryMeta): Promise<void> {
  connect().prepare(
    `INSERT INTO history (vacancy_id, status, at, meta) VALUES (?, 'applied', ?, ?)
     ON CONFLICT (vacancy_id) DO UPDATE SET
       status = 'applied',
       at = excluded.at,
       meta = excluded.meta`,
  ).run(String(vacancyId), Date.now(), toJson(meta));
}

// Важно: 'seen' не должен затирать реальный отклик ('applied'),
// иначе apply снова попробует откликнуться на эту вакансию.
// Условие выражено в самом UPDATE: он остаётся одним атомарным запросом,
// а meta отклика не меняется (в Mongo seenUpdate тоже не трогал meta).
const SEEN_UPSERT = `
  INSERT INTO history (vacancy_id, status, at) VALUES (?, 'seen', ?)
  ON CONFLICT (vacancy_id) DO UPDATE SET
    status = CASE WHEN history.status = 'applied' THEN 'applied' ELSE 'seen' END,
    at = CASE WHEN history.status = 'applied' THEN history.at ELSE excluded.at END
`;

export async function markSeen(vacancyId: string): Promise<void> {
  connect().prepare(SEEN_UPSERT).run(String(vacancyId), Date.now());
}

const _default = { load, markApplied, markSeen };
export default _default;
