// Выдача поиска в Markdown: data/search/search-ГГГГ-ММ-ДД.md.
// Файл — зеркало кэша страниц (MongoDB cachePages); источник правды для шагов digest/cover
// остаётся в Mongo, здесь только просмотр и сравнение выдачи без базы.
import fs from "fs";
import path from "path";
import { SearchEntry } from "../types.js";
import { SEARCH_DIR, ensureDir } from "../paths.js";
import { dateKey } from "../time.js";

// Формат — как у digest-store: блок на вакансию, разделитель `---`.
function toMarkdown(entries: SearchEntry[], date: string, query?: string): string {
  const lines: string[] = [`# Результаты поиска — ${date} (${entries.length} вакансий)\n`];
  if (query) lines.push(`Запрос: \`${query}\`\n`);
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

/**
 * Пишет выдачу за день, перезаписывая файл целиком (идемпотентно за дату).
 *
 * Контракт: `null` — писать нечего (пустая выдача), иначе путь к .md. Файл отражает весь кэш
 * страниц за дату, а не только текущий прогон, поэтому список собирает вызывающий
 * (`flattenCollected(cache)` в cmd-search).
 */
export function writeSearchResults(entries: SearchEntry[], opts: { date?: string; query?: string } = {}): string | null {
  if (!entries.length) return null;
  const date = opts.date || dateKey();
  ensureDir(SEARCH_DIR);
  const md = path.join(SEARCH_DIR, `search-${date}.md`);
  fs.writeFileSync(md, toMarkdown(entries, date, opts.query));
  return md;
}
