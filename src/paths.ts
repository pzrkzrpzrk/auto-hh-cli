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
export const SEARCH_DIR = path.join(DATA_DIR, 'search');
export const DIGEST_DIR = path.join(DATA_DIR, 'digests');
export const REJECTED_DIR = path.join(DATA_DIR, 'rejected');

/** Создаёт каталог (по умолчанию data/), если его нет. Возвращает путь. */
export function ensureDir(dir: string = DATA_DIR): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
