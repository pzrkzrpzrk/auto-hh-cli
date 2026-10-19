// Шаг показа и актуализации дайджеста + совместимая обёртка сборки.
// Сама сборка живёт в application/digest/DigestScenario.ts (конвейер стадий);
// здесь остались show/actualize до их перевода в сценарии (этап 7.6).
import { readFileSync } from "fs";
import { loadConfig } from "../infrastructure/config/config.js";
import * as collectCache from "../infrastructure/mongo/cache-store.js";
import {
  writeDigest,
  writeRejected,
  writeActualDigest,
  writeActualRejected,
  listDigestDocs,
  getLatestDigest,
} from "../infrastructure/mongo/digest-store.js";
import { computeActualization, mergeActualized } from "../domain/actualize.js";
import { listDigestFiles } from "../infrastructure/files/digest-files.js";
import { DIGEST_DIR } from "../infrastructure/config/paths.js";
import type { DigestEntry } from "../domain/models.js";
import { flattenCollected } from "./collect.js";
import log from "../shared/logger.js";
import { DigestScenario } from "./digest/DigestScenario.js";
import type { DigestBuildResult } from "./digest/DigestScenario.js";
import type { DigestDeps } from "./digest/DigestDeps.js";

// Совместимость: команда и composition root импортируют типы из этого модуля.
export type { DigestDeps } from "./digest/DigestDeps.js";
export type { DigestBuildResult } from "./digest/DigestScenario.js";

/**
 * Шаг digest: совместимая обёртка над сценарием (application/digest/DigestScenario.ts).
 * null — собирать нечего (пустой кэш или пустая выдача). onMatched используется для печати топа.
 */
export async function buildDigest(
  opts: Record<string, any> = {},
  deps: DigestDeps,
  onMatched?: (matched: DigestEntry[]) => void,
): Promise<DigestBuildResult | null> {
  const scenario = new DigestScenario(deps, event => {
    if (event.type === 'matched' && onMatched) onMatched(event.matched);
  });
  return scenario.build(opts);
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



