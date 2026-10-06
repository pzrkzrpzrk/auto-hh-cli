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

export default async function resetData(): Promise<ResetSummary> {
  // Файлы артефактов: history.* в корне data/ (legacy digest-/rejected- — тоже там),
  // выдача поиска в data/search/, дайджест в data/digests/, rejected в data/rejected/.
  const files: string[] = [];
  const targets = [
    { dir: DATA_DIR, pattern: /^(history|digest|rejected)[.-]/ },
    { dir: SEARCH_DIR, pattern: /^search-.*\.md$/ },
    { dir: DIGEST_DIR, pattern: /^digest-.*\.md$/ },
    { dir: REJECTED_DIR, pattern: /^rejected-.*\.md$/ },
  ];
  for (const { dir, pattern } of targets) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!pattern.test(name)) continue;
      const p = path.join(dir, name);
      fs.unlinkSync(p);
      log.info(`Removed ${p}`);
      files.push(p);
    }
  }

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
