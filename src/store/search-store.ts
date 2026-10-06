// Выдача поиска в Markdown: data/search/search-ГГГГ-ММ-ДД.md.
// Файл накапливает за день только новые вакансии (дедуп по id); источник правды для шагов
// digest/cover остаётся в Mongo (cachePages), здесь только просмотр и сравнение выдачи без базы.
import fs from "fs";
import path from "path";
import { SearchEntry, SearchFileResult } from "../types.js";
import { SEARCH_DIR, ensureDir } from "../paths.js";
import { dateKey } from "../time.js";

// Формат — как у digest-store: блок на вакансию, разделитель `---`.
// Заголовок и тело разделены: при дозаписи обновляется только счётчик, уже записанные
// блоки берутся из файла как есть (без повторного разбора).
function header(date: string, count: number, query?: string): string {
  const lines: string[] = [`# Результаты поиска — ${date} (${count} вакансий)\n`];
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

/**
 * Дописывает в выдачу за день только новые вакансии (дедуп по id против уже записанных).
 *
 * Контракт: `{ file, added, total }`; `added === 0` — новых нет, файл не переписывается;
 * `null` — файла нет и писать нечего. Файл накапливает выдачу за дату и не теряет ранее
 * записанные строки (в отличие от прежней перезаписи из кэша). Список собирает вызывающий
 * (`flattenCollected(cache)` в cmd-search).
 */
export function writeSearchResults(entries: SearchEntry[], opts: { date?: string; query?: string } = {}): SearchFileResult | null {
  const date = opts.date || dateKey();
  const md = path.join(SEARCH_DIR, `search-${date}.md`);
  const exists = fs.existsSync(md);
  const old = exists ? fs.readFileSync(md, 'utf8') : '';

  const written = parseWrittenIds(old);
  const fresh = entries.filter(e => !written.has(String(e.id)));
  if (!fresh.length) {
    return exists ? { file: md, added: 0, total: written.size } : null;
  }

  ensureDir(SEARCH_DIR);
  const body = fileBody(old);
  const total = written.size + fresh.length;
  const merged = body ? `${body}\n${blocks(fresh)}` : blocks(fresh);
  fs.writeFileSync(md, header(date, total, opts.query) + '\n' + merged);
  return { file: md, added: fresh.length, total };
}
