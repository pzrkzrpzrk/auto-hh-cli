// Адаптер порта DataJanitor: очистка файлов data/ и коллекций MongoDB.
// Код перенесён из application/reset.ts без изменения поведения: те же регулярки имён,
// те же каталоги и коллекции, та же сводка (её форматирует сценарий).
// Появился точечный сброс одного резюме: его папка в data/hh-parsing и его Mongo-данные.
import fs from "fs";
import path from "path";
import { connect, dbInstance } from "@/infrastructure/mongo/db.js";
import * as collectCache from "@/infrastructure/mongo/cache-store.js";
import {
  DATA_DIR,
  PARSING_DIR,
  LEGACY_SEARCH_DIR,
  LEGACY_DIGEST_DIR,
  LEGACY_REJECTED_DIR,
  resumeArtifactsDir,
} from "@/infrastructure/config/paths.js";
import type { DataJanitor, ResetSummary } from "@/domain/ports.js";
import type { ResumeRef } from "@/domain/models.js";
import log from "@/shared/logger.js";

async function clearMongoCollection(
  name: string,
  filter: Record<string, any> = {},
): Promise<{ collection: string; deleted: number }> {
  try {
    await connect();
    const r = await dbInstance().collection(name).deleteMany(filter);
    const deleted = r.deletedCount ?? 0;
    if (deleted) log.info(`Mongo ${name}: ${deleted} docs cleared`);
    return { collection: name, deleted };
  } catch (err: any) {
    // Молча глотать нельзя: недоступная MongoDB выглядела как успешный сброс.
    log.warn(`Mongo ${name}: не очищено — ${err?.message || err}`);
    return { collection: name, deleted: 0 };
  }
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

// Рекурсивное удаление каталога с защитой: снести можно только то, что лежит внутри guard.
function removeTree(dir: string, guard: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  const rel = path.relative(path.resolve(guard), path.resolve(dir));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    log.warn(`Refusing to remove ${dir}: outside ${guard}`);
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  log.info(`Removed ${dir}`);
  files.push(dir);
}

class FileDataJanitor implements DataJanitor {
  async clearAll(): Promise<ResetSummary> {
    // Файлы артефактов: history.* в корне data/ (legacy digest-/rejected- — тоже там),
    // новая раскладка — data/hh-parsing/<резюме>/<search|digests|rejected>/...;
    // старые плоские каталоги data/search|digests|rejected чистятся целиком.
    const files: string[] = [];
    removeFlat(DATA_DIR, name => /^(history|digest|rejected)[.-]/.test(name), files);
    removeRecursive(LEGACY_SEARCH_DIR, name => name === 'search.md' || /^search-.*\.md$/.test(name), files);
    removeRecursive(LEGACY_DIGEST_DIR, name => name === 'digest.md' || name === 'actual.md' || /^digest-.*\.md$/.test(name), files);
    removeRecursive(LEGACY_REJECTED_DIR, name => name === 'rejected.md' || name === 'actual.md' || /^rejected-.*\.md$/.test(name), files);
    removeTree(PARSING_DIR, DATA_DIR, files);

    // MongoDB. process.exit() тут быть не должно: иначе `search --reset` убивал бы
    // процесс сразу после очистки кэша — до самого поиска. Закрытие соединения
    // делает вызывающая сторона (run() в src/presentation/cli/index.ts).
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

  /**
   * Сброс одного резюме. Не трогает исходники в data/resumes, реестр resumes
   * и общий кэш страниц/карточек (если не попросили includeSearchCache).
   */
  async clearResume(resume: ResumeRef, opts: { includeSearchCache?: boolean } = {}): Promise<ResetSummary> {
    const files: string[] = [];
    removeTree(resumeArtifactsDir(resume), PARSING_DIR, files);

    const filter = { resumeId: resume.id };
    const mongo = await Promise.all([
      clearMongoCollection('digest', filter),
      clearMongoCollection('rejected', filter),
      clearMongoCollection('cacheJudgements', filter),
      clearMongoCollection('cacheCoverLetters', filter),
      // Отклики именно этого резюме: без их удаления apply пропустит вакансии как уже обработанные.
      clearMongoCollection('history', { 'meta.resumeId': resume.id }),
    ]);

    const cache: string[] = [];
    if (opts.includeSearchCache) {
      // Общий кэш поиска: search сразу перезапишет его свежей выдачей.
      const pages = await clearMongoCollection('cachePages');
      const full = await clearMongoCollection('cacheFull');
      if (pages.deleted) cache.push(`cachePages: ${pages.deleted}`);
      if (full.deleted) cache.push(`cacheFull: ${full.deleted}`);
    }

    return { mongo, files, cache };
  }
}

export default FileDataJanitor;
