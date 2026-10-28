// Рендер дайджеста/rejected в Markdown и запись по регионам.
// Здесь живёт единственное знание формата `.md`-артефактов дайджеста: SQLite-адаптер
// и сценарии его не дублируют, а вызывают эти функции.
import fs from "fs";
import path from "path";
import { dateKey } from "@/shared/time.js";
import { UNKNOWN_REGION, ensureDir, regionDir } from "@/infrastructure/config/paths.js";

/** Markdown одного артефакта: заголовок, блок на вакансию, архивные записи в конце. */
export function renderDigestMarkdown(entries: any[], title: string, date = dateKey()): string {
  const gone = entries.filter(e => e.archived).length;
  const countNote = gone ? `${entries.length} вакансий, недоступно ${gone}` : `${entries.length} вакансий`;
  const lines: string[] = [`# ${title} — ${date} (${countNote})\n`];
  // Архивные записи (шаг actualize) уводим в конец: живые вакансии остаются сверху.
  const ordered = gone
    ? [...entries].sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)))
    : entries;
  for (const e of ordered) {
    lines.push(`---`);
    lines.push(`**${e.title || '—'}** @ ${e.employer || '—'}`);
    lines.push(`- Регион: ${e.area || '—'}`);
    if (e.archived) lines.push(`- Статус: больше не в поиске${e.checkedAt ? ` (проверено ${e.checkedAt})` : ''}`);
    lines.push(`- Зарплата: ${e.salary || '—'}`);
    if (e.publishedAt) lines.push(`- Опубликована: ${String(e.publishedAt).slice(0, 10)}`);
    if (e.score != null) lines.push(`- Оценка: ${e.score}/10`);
    if (e.reason) lines.push(`- Причина: ${e.reason}`);
    if (e.comment) lines.push(`- Совпадение: ${e.comment}`);
    if (e.url) lines.push(`- Ссылка: ${e.url}`);
    if (e.coverLetter) {
      lines.push(`\n**Сопроводительное:**\n\n${e.coverLetter}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// Регион вакансии — имя папки. Плейсхолдер '—' (area не пришёл) — как «Не указан».
function regionOf(entry: any): string {
  const area = entry?.area;
  return !area || area === '—' ? UNKNOWN_REGION : String(area);
}

// Группировка записей по региону с сохранением порядка появления.
function groupByArea(entries: any[]): Map<string, any[]> {
  const groups = new Map<string, any[]>();
  for (const e of entries) {
    const key = regionOf(e);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }
  return groups;
}

/** Пишет по файлу на регион: <baseDir>/<date>/<region>/<fileName>. Возвращает пути файлов. */
export function writeRegionArtifacts(
  baseDir: string,
  entries: any[],
  date: string,
  fileName: string,
  titlePrefix: string,
): string[] {
  const files: string[] = [];
  for (const [region, group] of groupByArea(entries)) {
    const dir = regionDir(baseDir, date, region);
    ensureDir(dir);
    const md = path.join(dir, fileName);
    fs.writeFileSync(md, renderDigestMarkdown(group, `${titlePrefix} — ${region}`, date));
    files.push(md);
  }
  return files;
}

/** Сводный снимок на дату без разбивки по регионам: <baseDir>/<date>/actual.md. */
export function writeActualArtifact(baseDir: string, entries: any[], date: string, title: string): string | null {
  if (!entries.length) return null;
  const dir = path.join(baseDir, date);
  ensureDir(dir);
  const md = path.join(dir, 'actual.md');
  fs.writeFileSync(md, renderDigestMarkdown(entries, title, date));
  return md;
}
