// Разбор резюме на шапку и секции и отбор строк блока навыков.
//
// Шапка (должность, зарплата, переезд) и навыки — «ядро»: они идут в промпт всегда,
// поэтому разбор отделён от ранжирования секций.
import type { VacancyTerms } from "@/domain/adapt-resume/terms.js";
import { tokenize } from "@/domain/adapt-resume/terms.js";

/** Ограничение на блок «Ключевые навыки» внутри ядра. */
const SKILLS_LIMIT = 800;

/** Секция резюме: заголовок с решётками, тело без заголовка и исходный кусок. */
export interface ResumeSection {
  heading: string;
  body: string;
  raw: string;
  /** Исходный порядок — для стабильной сортировки при равном весе. */
  order: number;
}

/**
 * Резюме на секции: шапка (всё до первого заголовка уровня 2+) и секции по `##`/`###`.
 * Заголовок `#` (обычно ФИО) остаётся в шапке — именно там должность, зарплата, переезд.
 */
export function splitSections(text: string): { head: string; sections: ResumeSection[] } {
  const headings: { index: number; level: number; line: string }[] = [];
  const re = /^(#{1,3})[ \t]+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    headings.push({ index: match.index, level: match[1].length, line: match[0].trim() });
  }

  const firstSection = headings.findIndex((h) => h.level >= 2);
  if (firstSection === -1) return { head: text.trim(), sections: [] };

  const head = text.slice(0, headings[firstSection].index).trim();
  const sections: ResumeSection[] = [];
  for (let i = firstSection; i < headings.length; i++) {
    const start = headings[i].index;
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
    const raw = text.slice(start, end).trim();
    if (!raw) continue;
    const body = raw.slice(headings[i].line.length).trim();
    sections.push({ heading: headings[i].line, body, raw, order: sections.length });
  }
  return { head, sections };
}

/** Секция навыков: «Ключевые навыки», «Навыки», «Стек», «Skills». */
export function isSkillsSection(heading: string): boolean {
  return /навык|skills|стек|технолог/.test(heading.toLowerCase());
}

/**
 * Навыки: сначала пересекающиеся с вакансией, затем остальные — до SKILLS_LIMIT.
 * Полный список полезен модели как контекст, но платить за него токенами незачем.
 */
export function renderSkills(section: ResumeSection, terms: VacancyTerms): string {
  const lines = section.body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return section.raw;

  const strong = new Set(terms.strong.keys());
  const weak = new Set(terms.weak.keys());
  const matched: string[] = [];
  const other: string[] = [];
  for (const line of lines) {
    const tokens = tokenize(line);
    const hit = tokens.some((t) => strong.has(t) || weak.has(t));
    (hit ? matched : other).push(line);
  }

  const picked: string[] = [];
  let size = section.heading.length + 2;
  for (const line of [...matched, ...other]) {
    if (picked.length > 0 && size + line.length + 3 > SKILLS_LIMIT) break;
    picked.push(line);
    size += line.length + 3;
  }

  return `${section.heading}\n${picked.join("\n")}`;
}
