// Выдача поиска в Markdown: data/search/<ГГГГ-ММ-ДД>/<Регион>/search.md.
// Файл накапливает за день только новые вакансии (дедуп по id) — по регионам отдельно; источник правды
// для шагов digest/cover остаётся в Mongo (cachePages), здесь только просмотр и сравнение выдачи без базы.
import fs from "fs";
import path from "path";
import { SearchEntry, SearchFileResult } from "../types.js";
import { SEARCH_DIR, UNKNOWN_REGION, ensureDir, regionDir } from "../paths.js";
import { dateKey } from "../time.js";

// Формат — как у digest-store: блок на вакансию, разделитель `---`.
// Заголовок и тело разделены: при дозаписи обновляется только счётчик, уже записанные
// блоки берутся из файла как есть (без повторного разбора).
function header(date: string, count: number, query?: string, region?: string): string {
  const where = region ? `${region}, ` : '';
  const lines: string[] = [`# Результаты поиска — ${where}${date} (${count} вакансий)\n`];
  if (query) lines.push(`Запрос: \`${query}\`\n`);
  return lines.join('\n');
}

// Блоки вакансий без заголовка. Каждый блок завершается пустой строкой, поэтому между
// блоками встаёт пустая строка, а файл заканчивается переводом строки.
function blocks(entries: SearchEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`---`);
    lines.push(`**${e.title || '—'}** @ ${e.employer || '—'}`);
    lines.push(`- Регион: ${e.area || '—'}`);
    lines.push(`- Зарплата: ${e.salary || '—'}`);
    lines.push(`- ID: ${e.id}`);
    if (e.url) lines.push(`- Ссылка: ${e.url}`);
    lines.push('');
  }
  return lines.join('\n');
}

// Уже записанные в файле id — по строкам `- ID: <id>`. Пусто, если файла нет.
function parseWrittenIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^- ID: (\S+)\s*$/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

// Тело файла без заголовка — от первой строки-разделителя `---` до конца.
function fileBody(text: string): string {
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.trim() === '---');
  return idx < 0 ? '' : lines.slice(idx).join('\n');
}

// Регион записи — имя папки. Плейсхолдер '—' (area не пришёл) — как «Не указан».
function regionOf(entry: SearchEntry): string {
  const area = (entry as any)?.area;
  return !area || area === '—' ? UNKNOWN_REGION : String(area);
}

/**
 * Дописывает в выдачу за день (по регионам) только новые вакансии (дедуп по id против уже записанных).
 *
 * Контракт: массив `{ file, added, total }` — по одному элементу на регион; `added === 0` означает,
 * что для региона новых нет и файл не переписывается. Регион без файла и без новых вакансий в результат
 * не попадает. Файл накапливает выдачу за дату и не теряет ранее записанные строки. Список собирает
 * вызывающий (`flattenCollected(cache)` в cmd-search).
 */
export function writeSearchResults(entries: SearchEntry[], opts: { date?: string; query?: string } = {}): SearchFileResult[] {
  const date = opts.date || dateKey();

  const groups = new Map<string, SearchEntry[]>();
  for (const e of entries) {
    const key = regionOf(e);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  const results: SearchFileResult[] = [];
  for (const [region, group] of groups) {
    const dir = regionDir(SEARCH_DIR, date, region);
    const md = path.join(dir, 'search.md');
    const exists = fs.existsSync(md);
    const old = exists ? fs.readFileSync(md, 'utf8') : '';

    const written = parseWrittenIds(old);
    const fresh = group.filter(e => !written.has(String(e.id)));
    if (!fresh.length) {
      if (exists) results.push({ file: md, added: 0, total: written.size });
      continue;
    }

    ensureDir(dir);
    const body = fileBody(old);
    const total = written.size + fresh.length;
    const merged = body ? `${body}\n${blocks(fresh)}` : blocks(fresh);
    fs.writeFileSync(md, header(date, total, opts.query, region) + '\n' + merged);
    results.push({ file: md, added: fresh.length, total });
  }
  return results;
}
