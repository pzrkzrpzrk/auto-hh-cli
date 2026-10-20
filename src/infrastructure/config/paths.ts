// Единая точка правды по путям проекта.
// До этого каталог data/ собирался в 5 местах через path.join(__dirname, …, 'data'),
// причём глубина '..' зависела от расположения файла (в src/ — один, в src/cli и src/store — два).
import fs from "fs";
import path from "path";

// Файл лежит в src/infrastructure/config/, поэтому до корня проекта три '..'.
export const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
export const LOG_FILE = path.join(DATA_DIR, 'app.log');

// Каталоги артефактов: выдача поиска, дайджест и отбракованные вакансии.
// Это .md-зеркала Mongo-коллекций (cachePages / digest / rejected) для просмотра без базы.
// Раскладка по регионам: <dir>/<ГГГГ-ММ-ДД>/<Регион>/<файл>.md — регион берётся из area вакансии.
export const SEARCH_DIR = path.join(DATA_DIR, 'search');
export const DIGEST_DIR = path.join(DATA_DIR, 'digests');
export const REJECTED_DIR = path.join(DATA_DIR, 'rejected');

// Имя папки для вакансий без региона и санитизация сегментов пути — общие утилиты
// (shared/path-utils.ts): их использует и раскладка data/, и доменный рендер резюме.
import { UNKNOWN_REGION, sanitizeSegment } from "@/shared/path-utils.js";
export { UNKNOWN_REGION, sanitizeSegment };


/** Каталог артефакта за дату и регион: <baseDir>/<date>/<region>. */
export function regionDir(baseDir: string, date: string, region: string): string {
  return path.join(baseDir, date, sanitizeSegment(region));
}

/** Создаёт каталог (по умолчанию data/), если его нет. Возвращает путь. */
export function ensureDir(dir: string = DATA_DIR): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
