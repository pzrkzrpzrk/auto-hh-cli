// Очистка файлов data/: артефакты поиска, дайджестов и rejected.
// Про БД адаптер не знает — таблицы чистит DbJanitor, объединяет их CompositeDataJanitor.
import fs from "fs";
import path from "path";
import {
  DATA_DIR,
  PARSING_DIR,
  LEGACY_SEARCH_DIR,
  LEGACY_DIGEST_DIR,
  LEGACY_REJECTED_DIR,
  resumeArtifactsDir,
} from "@/infrastructure/config/paths.js";
import type { ResumeRef } from "@/domain/models.js";
import log from "@/shared/logger.js";

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

class FileJanitor {
  /** Полный сброс: legacy-файлы в data/ и все папки артефактов по резюме. */
  clearAll(): string[] {
    // Файлы артефактов: history.* в корне data/ (legacy digest-/rejected- — тоже там),
    // новая раскладка — data/hh-parsing/<резюме>/<search|digests|rejected>/...;
    // старые плоские каталоги data/search|digests|rejected чистятся целиком.
    const files: string[] = [];
    removeFlat(DATA_DIR, name => /^(history|digest|rejected)[.-]/.test(name), files);
    removeRecursive(LEGACY_SEARCH_DIR, name => name === 'search.md' || /^search-.*\.md$/.test(name), files);
    removeRecursive(LEGACY_DIGEST_DIR, name => name === 'digest.md' || name === 'actual.md' || /^digest-.*\.md$/.test(name), files);
    removeRecursive(LEGACY_REJECTED_DIR, name => name === 'rejected.md' || name === 'actual.md' || /^rejected-.*\.md$/.test(name), files);
    removeTree(PARSING_DIR, DATA_DIR, files);
    return files;
  }

  /** Артефакты одного резюме: его папка в data/hh-parsing. */
  clearResume(resume: ResumeRef): string[] {
    const files: string[] = [];
    removeTree(resumeArtifactsDir(resume), PARSING_DIR, files);
    return files;
  }
}

export default FileJanitor;
