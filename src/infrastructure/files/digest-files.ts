// Раскладка дайджестов на диске (fallback, когда база данных недоступна).
// Новая раскладка — <dir>/<date>/<region>/digest.md (берём самую свежую дату, все регионы),
// legacy <dir>/digest-<date>.md — как запасной вариант (только самый свежий файл).
import fs from "fs";
import path from "path";

export function listDigestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const dateDirs = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map(e => e.name)
    .sort()
    .reverse();
  if (dateDirs.length) {
    const latest = path.join(dir, dateDirs[0]);
    return fs.readdirSync(latest, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(latest, e.name, 'digest.md'))
      .filter(p => fs.existsSync(p))
      .sort();
  }
  const legacy = fs.readdirSync(dir).filter(f => /^digest-.*\.md$/.test(f)).sort().reverse();
  return legacy.length ? [path.join(dir, legacy[0])] : [];
}
