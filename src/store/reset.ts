// Сброс истории, кэша и дайджестов (файлы + MongoDB).
import fs from "fs";
import path from "path";
import { connect, dbInstance } from "../clients/db.js";
import * as collectCache from "./cache-store.js";
import { DATA_DIR, SEARCH_DIR, DIGEST_DIR, REJECTED_DIR } from "../paths.js";
import log from "../logger.js";

export interface ResetSummary {
  mongo: { collection: string; deleted: number }[];
  files: string[];
  cache: string[];
}

async function clearMongoCollection(name: string): Promise<{ collection: string; deleted: number }> {
  try {
    await connect();
    const r = await dbInstance().collection(name).deleteMany({});
    const deleted = r.deletedCount ?? 0;
    if (deleted) log.info(`Mongo ${name}: ${deleted} docs cleared`);
    return { collection: name, deleted };
  } catch (err: any) {
    // Молча глотать нельзя: недоступная MongoDB выглядела как успешный сброс.
    log.warn(`Mongo ${name}: не очищено — ${err?.message || err}`);
    return { collection: name, deleted: 0 };
  }
}

/** Строка-сводка для консоли: «history 1278, digest 7, cachePages 65». */
export function formatResetSummary(s: ResetSummary): string {
  return [
    ...s.mongo.filter(m => m.deleted).map(m => `${m.collection} ${m.deleted}`),
    ...s.cache,
  ].join(', ');
}

// Плоский проход: удаляет совпавшие файлы в самом каталоге (legacy history.*/digest-* в data/).
function removeFlat(dir: string, match: (name: string) => boolean, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!match(name)) continue;
    const p = path.join(dir, name);
    if (!fs.statSync(p).isFile()) continue;
    fs.unlinkSync(p);
    log.info(`Removed ${p}`);
    files.push(p);
  }
}

// Рекурсивный проход: удаляет совпавшие файлы в <dir>/<date>/<region>/ и подчищает пустые каталоги.
function removeRecursive(dir: string, match: (name: string) => boolean, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeRecursive(p, match, files);
      if (!fs.readdirSync(p).length) fs.rmdirSync(p);
      continue;
    }
    if (match(entry.name)) {
      fs.unlinkSync(p);
      log.info(`Removed ${p}`);
      files.push(p);
    }
  }
}

export default async function resetData(): Promise<ResetSummary> {
  // Файлы артефактов: history.* в корне data/ (legacy digest-/rejected- — тоже там),
  // новая раскладка — <dir>/<date>/<region>/<file>.md в data/search|digests|rejected/;
  // старые плоские search-*/digest-*/rejected-*.md подчищаются тем же проходом.
  const files: string[] = [];
  removeFlat(DATA_DIR, name => /^(history|digest|rejected)[.-]/.test(name), files);
  removeRecursive(SEARCH_DIR, name => name === 'search.md' || /^search-.*\.md$/.test(name), files);
  removeRecursive(DIGEST_DIR, name => name === 'digest.md' || name === 'actual.md' || /^digest-.*\.md$/.test(name), files);
  removeRecursive(REJECTED_DIR, name => name === 'rejected.md' || name === 'actual.md' || /^rejected-.*\.md$/.test(name), files);

  // MongoDB. process.exit() тут быть не должно: иначе `search --reset` убивал бы
  // процесс сразу после очистки кэша — до самого поиска. Закрытие соединения
  // делает вызывающая сторона (run() в src/cli/index.ts).
  const [history, digest, rejected, cache] = await Promise.all([
    clearMongoCollection('history'),
    clearMongoCollection('digest'),
    clearMongoCollection('rejected'),
    collectCache.clear().catch((err: any) => {
      log.warn(`Кэш: не очищен — ${err?.message || err}`);
      return [] as string[];
    }),
  ]);
  cache.forEach(p => log.info(`Removed ${p}`));

  return { mongo: [history, digest, rejected], files, cache };
}
