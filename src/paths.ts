// Единая точка правды по путям проекта.
// До этого каталог data/ собирался в 5 местах через path.join(__dirname, …, 'data'),
// причём глубина '..' зависела от расположения файла (в src/ — один, в src/cli и src/store — два).
import fs from "fs";
import path from "path";

// Файл лежит в src/, поэтому до корня проекта ровно один '..'.
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const LOG_FILE = path.join(DATA_DIR, 'app.log');

// Каталоги артефактов: выдача поиска, дайджест и отбракованные вакансии.
// Это .md-зеркала Mongo-коллекций (cachePages / digest / rejected) для просмотра без базы.
// Раскладка по регионам: <dir>/<ГГГГ-ММ-ДД>/<Регион>/<файл>.md — регион берётся из area вакансии.
export const SEARCH_DIR = path.join(DATA_DIR, 'search');
export const DIGEST_DIR = path.join(DATA_DIR, 'digests');
export const REJECTED_DIR = path.join(DATA_DIR, 'rejected');

// Имя папки для вакансий без региона (area не пришёл или плейсхолдер '—').
export const UNKNOWN_REGION = 'Не указан';

/**
 * Санитизация одного сегмента пути (имя папки региона).
 * Названия регионов hh.ru — это города, но «/», «:» и прочие недопустимые в путях
 * символы (особенно на Windows) нельзя пускать в имя каталога. Пустой результат
 * заменяем на «Не указан», чтобы у вакансии всегда была папка.
 */
export function sanitizeSegment(value: string): string {
  const cleaned = String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || UNKNOWN_REGION;
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
