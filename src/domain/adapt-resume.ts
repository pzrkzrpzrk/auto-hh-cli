// Адаптация резюме под конкретную вакансию.
//
// Раньше это был бинарный фильтр «секция подошла / не подошла» по подстроке: шапка с
// зарплатой и готовностью к переезду могла выпасть, а при отсутствии совпадений резюме
// не отправлялось вовсе. Теперь секции ранжируются по весу совпавших терминов, «ядро»
// (шапка + ключевые навыки) включается всегда, а объём ограничен бюджетом символов.
//
// Всё локально и детерминированно: сеть и модель не используются.
import { stripHtml } from "@/shared/text-utils.js";
import type { Resume, Vacancy } from "@/domain/models.js";

/** Сколько символов адаптированного резюме по умолчанию уходит в промпт. */
export const DEFAULT_ADAPT_BUDGET = 3500;

/** Ограничение на блок «Ключевые навыки» внутри ядра. */
const SKILLS_LIMIT = 800;

/** Минимальный вес секции, чтобы считать её релевантной (1 сильный термин или 2 слабых). */
const MIN_SCORE = 1;

/** Длина основы для кириллицы: «разработкой» и «разработчик» дают общий префикс. */
const RU_STEM_LEN = 5;

export interface AdaptResumeOptions {
  /** Лимит символов на адаптированный текст (по умолчанию DEFAULT_ADAPT_BUDGET). */
  budgetChars?: number;
}

/** Секция резюме: заголовок с решётками, тело без заголовка и исходный кусок. */
interface ResumeSection {
  heading: string;
  body: string;
  raw: string;
  /** Исходный порядок — для стабильной сортировки при равном весе. */
  order: number;
}

/** Термины вакансии с весами: strong — название и навыки, weak — описание. */
interface VacancyTerms {
  strong: Map<string, number>;
  weak: Map<string, number>;
}

// Разные написания одной технологии → один канонический ключ.
// Только латиница: русские слова приводит к основе RU_STEM_LEN.
const ALIASES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  ecmascript: 'javascript',
  es6: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  react: 'react',
  reactjs: 'react',
  'react.js': 'react',
  next: 'nextjs',
  nextjs: 'nextjs',
  'next.js': 'nextjs',
  vue: 'vue',
  vuejs: 'vue',
  'vue.js': 'vue',
  angular: 'angular',
  angularjs: 'angular',
  node: 'nodejs',
  nodejs: 'nodejs',
  'node.js': 'nodejs',
  express: 'express',
  expressjs: 'express',
  nest: 'nestjs',
  nestjs: 'nestjs',
  'nest.js': 'nestjs',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  pg: 'postgresql',
  mongo: 'mongodb',
  mongodb: 'mongodb',
  kubernetes: 'kubernetes',
  k8s: 'kubernetes',
  csharp: 'c#',
  cpp: 'c++',
  golang: 'go',
  'ci/cd': 'ci',
};

// Служебные слова: без них «разработчик» из названия вакансии совпадает со всеми секциями.
const STOP_RU_PREFIXES = [
  'разра', // разработчик, разработка, разработкой
  'прогр', // программист, программирование
  'инжен', // инженер
  'специ', // специалист
  'опыт', // опыт, опыта
  'работ', // работа, работы, работодатель
  'коман', // команда, командой
  'задач', // задача, задачи
  'проек', // проект, проекты
  'требов', // требования
  'обяза', // обязанности
  'услов', // условия
  'компа', // компания
  'вакан', // вакансия
];

const STOP_WORDS = new Set([
  'and', 'the', 'with', 'for', 'from', 'you', 'your', 'our', 'are', 'will', 'not',
  'senior', 'middle', 'junior', 'lead', 'developer', 'engineer', 'specialist',
  'remote', 'office', 'hybrid', 'fulltime', 'parttime',
  'москва', 'питер', 'спб', 'россия', 'удаленка', 'гибрид', 'офис',
  'лет', 'года', 'год',
]);

// Короткие технологии, которые нельзя отбрасывать по длине.
const SHORT_OK = new Set(['js', 'ts', 'go', 'ci', 'cd', 'c#', 'c++', '1c', 'ui', 'ux', 'qa', 'pm']);

const EMPTY_TERMS: VacancyTerms = { strong: new Map(), weak: new Map() };

/**
 * Адаптированное под вакансию резюме: шапка и ключевые навыки всегда, остальные секции —
 * по убыванию релевантности, пока не исчерпан бюджет символов.
 *
 * null — только когда адаптировать нечего (резюме нет, это PDF или пустой текст).
 * Если ни одна секция не совпала, возвращается ядро (а не пустая строка): судье и
 * генератору писем нужен хоть какой-то контекст о соискателе.
 */
export function adaptResumeForVacancy(
  resume: Resume | null,
  vacancy: Vacancy,
  options: AdaptResumeOptions = {},
): string | null {
  if (!resume || resume.type === "pdf" || !resume.text) return null;

  const text = resume.text.replace(/\r\n/g, "\n").trim();
  if (!text) return null;

  const budget = Math.max(500, Math.floor(options.budgetChars ?? DEFAULT_ADAPT_BUDGET) || DEFAULT_ADAPT_BUDGET);
  const terms = collectTerms(vacancy);
  const { head, sections } = splitSections(text);

  // Резюме без ##-заголовков делить не на что — отдаём исходник в пределах бюджета.
  if (sections.length === 0) return clip(text, budget);

  const core: string[] = [];
  if (head) core.push(head);

  const skills = sections.find((s) => isSkillsSection(s.heading));
  if (skills) {
    const rendered = renderSkills(skills, terms);
    if (rendered) core.push(rendered);
  }

  let out = core.join("\n\n");

  const scored = sections
    .filter((s) => s !== skills)
    .map((s) => ({ section: s, score: scoreSection(s, terms) }))
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.section.order - b.section.order);

  for (const { section } of scored) {
    const chunk = section.raw.trim();
    if (!chunk) continue;
    // Секции сверх бюджета пропускаем, но ядро остаётся всегда.
    if (out && out.length + chunk.length + 2 > budget) continue;
    out = out ? `${out}\n\n${chunk}` : chunk;
  }

  return clip(out || text, budget);
}

/**
 * Резюме на секции: шапка (всё до первого заголовка уровня 2+) и секции по `##`/`###`.
 * Заголовок `#` (обычно ФИО) остаётся в шапке — именно там должность, зарплата, переезд.
 */
function splitSections(text: string): { head: string; sections: ResumeSection[] } {
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
function isSkillsSection(heading: string): boolean {
  return /навык|skills|стек|технолог/.test(heading.toLowerCase());
}

/**
 * Навыки: сначала пересекающиеся с вакансией, затем остальные — до SKILLS_LIMIT.
 * Полный список полезен модели как контекст, но платить за него токенами незачем.
 */
function renderSkills(section: ResumeSection, terms: VacancyTerms): string {
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

/** Вес секции: навыки вакансии ×3, её название ×2, описание ×1 (в теле — половинный вклад). */
function scoreSection(section: ResumeSection, terms: VacancyTerms): number {
  const headTokens = new Set(tokenize(section.heading));
  const bodyTokens = new Set(tokenize(section.body));

  let score = 0;
  for (const [term, weight] of terms.strong) {
    if (headTokens.has(term)) score += weight * 2;
    else if (bodyTokens.has(term)) score += weight;
  }
  for (const [term, weight] of terms.weak) {
    if (headTokens.has(term)) score += weight;
    else if (bodyTokens.has(term)) score += weight * 0.5;
  }
  return score;
}

/** Термины вакансии: сильные (название, навыки) и слабые (описание). */
function collectTerms(vacancy: Vacancy): VacancyTerms {
  const strong = new Map<string, number>();
  const weak = new Map<string, number>();

  addTokens(strong, vacancy.name, 2);
  for (const skill of vacancy.key_skills ?? []) {
    addTokens(strong, skill?.name, 3);
  }
  addTokens(weak, stripHtml(vacancy.description), 1);

  // Термин, пришедший и из навыков, и из описания, остаётся сильным.
  for (const term of strong.keys()) weak.delete(term);

  return strong.size || weak.size ? { strong, weak } : EMPTY_TERMS;
}

function addTokens(target: Map<string, number>, text: string | null | undefined, weight: number): void {
  if (!text) return;
  for (const token of tokenize(String(text))) {
    const prev = target.get(token) ?? 0;
    if (weight > prev) target.set(token, weight);
  }
}

/** Текст → канонические токены (lowercase, ё→е, алиасы технологий, основы слов). */
function tokenize(text: string): string[] {
  const prepared = text.toLowerCase().replace(/ё/g, "е");
  const tokens: string[] = [];
  for (const raw of prepared.split(/[^a-zа-я0-9+#.]+/)) {
    const token = canonical(raw.replace(/^\.+|\.+$/g, ""));
    if (token) tokens.push(token);
  }
  return tokens;
}

/** Приводит слово к канонической форме или отбрасывает служебное/слишком короткое. */
function canonical(word: string): string {
  if (!word) return "";
  const alias = ALIASES[word];
  if (alias) return alias;

  if (/[а-я]/.test(word)) {
    if (STOP_WORDS.has(word) || STOP_RU_PREFIXES.some((p) => word.startsWith(p))) return "";
    if (word.length < 3) return "";
    return word.length > RU_STEM_LEN ? word.slice(0, RU_STEM_LEN) : word;
  }

  // Латиница: версии вроде «react18» сводим к базовому токену.
  const base = word.replace(/[0-9]+$/g, "");
  if (!base) return "";
  if (STOP_WORDS.has(base)) return "";
  if (ALIASES[base]) return ALIASES[base];
  if (base.length < 2 && !SHORT_OK.has(base)) return "";
  return base;
}

/** Обрезает текст по бюджету, стараясь завершиться на границе строки или предложения. */
function clip(text: string, budget: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= budget) return trimmed;
  const cut = trimmed.slice(0, budget);
  const at = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return (at > budget * 0.6 ? cut.slice(0, at) : cut).trim();
}

