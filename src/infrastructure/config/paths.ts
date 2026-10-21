// Единая точка правды по путям проекта.
// Артефакты (search/digests/rejected) живут в data/hh-parsing/<имя резюме> - <resumeId>/:
// так данные разных резюме не смешиваются, а reset умеет чистить одно резюме.
import fs from "fs";
import path from "path";
import type { ResumeRef } from "@/domain/models.js";
import { UNKNOWN_REGION, sanitizeSegment } from "@/shared/path-utils.js";

// Файл лежит в src/infrastructure/config/, поэтому до корня проекта три '..'.
export const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
export const LOG_FILE = path.join(DATA_DIR, 'app.log');

/** Корень артефактов по резюме: data/hh-parsing/<name - id>/{search,digests,rejected}. */
export const PARSING_DIR = path.join(DATA_DIR, 'hh-parsing');

/** Папка артефактов, когда резюме не выбрано или не найдено. */
export const NO_RESUME_FOLDER = 'no-resume';

// Плоская раскладка до появления папок резюме. Читается как fallback и чистится
// только глобальным reset: привязать старые файлы к резюме задним числом нельзя.
export const LEGACY_SEARCH_DIR = path.join(DATA_DIR, 'search');
export const LEGACY_DIGEST_DIR = path.join(DATA_DIR, 'digests');
export const LEGACY_REJECTED_DIR = path.join(DATA_DIR, 'rejected');

// Совместимость: прежние имена указывали на плоские каталоги.
export const SEARCH_DIR = LEGACY_SEARCH_DIR;
export const DIGEST_DIR = LEGACY_DIGEST_DIR;
export const REJECTED_DIR = LEGACY_REJECTED_DIR;

// Имя папки для вакансий без региона и санитизация сегментов пути — общие утилиты
// (shared/path-utils.ts): их использует и раскладка data/, и доменный рендер резюме.
export { UNKNOWN_REGION, sanitizeSegment };

/** Ограничение длины имени резюме в папке: длинные имена + вложенные даты ломают MAX_PATH. */
const RESUME_NAME_LIMIT = 50;

/** Имя папки резюме: `<name> - <id>`, либо no-resume, если id нет. */
export function resumeFolderName(resume?: ResumeRef | null): string {
  if (!resume?.id) return NO_RESUME_FOLDER;
  const raw = String(resume.name || '').trim() || resume.id;
  const name = sanitizeSegment(raw).slice(0, RESUME_NAME_LIMIT).trim();
  return `${name} - ${resume.id}`;
}

/** Корень артефактов одного резюме. */
export function resumeArtifactsDir(resume?: ResumeRef | null): string {
  return path.join(PARSING_DIR, resumeFolderName(resume));
}

export function searchDir(resume?: ResumeRef | null): string {
  return path.join(resumeArtifactsDir(resume), 'search');
}

export function digestDir(resume?: ResumeRef | null): string {
  return path.join(resumeArtifactsDir(resume), 'digests');
}

export function rejectedDir(resume?: ResumeRef | null): string {
  return path.join(resumeArtifactsDir(resume), 'rejected');
}

/** Каталог артефакта за дату и регион: <baseDir>/<date>/<region>. */
export function regionDir(baseDir: string, date: string, region: string): string {
  return path.join(baseDir, date, sanitizeSegment(region));
}

/** Создаёт каталог (по умолчанию data/), если его нет. Возвращает путь. */
export function ensureDir(dir: string = DATA_DIR): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
