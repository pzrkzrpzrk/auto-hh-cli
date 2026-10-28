// Отбор секций резюме под конкретную вакансию: вес совпавших терминов и бюджет.
//
// Раньше это был бинарный фильтр «секция подошла / не подошла» по подстроке: шапка с
// зарплатой и готовностью к переезду могла выпасть, а при отсутствии совпадений резюме
// не отправлялось вовсе. Теперь секции ранжируются по весу совпавших терминов, «ядро»
// (шапка + ключевые навыки) включается всегда, а объём ограничен бюджетом символов.
//
// Всё локально и детерминированно: сеть и модель не используются.
import type { Resume, Vacancy } from "@/domain/models.js";
import { adaptBudget } from "@/domain/adapt-resume/budget.js";
import type { ResumeSection } from "@/domain/adapt-resume/sections.js";
import { isSkillsSection, renderSkills, splitSections } from "@/domain/adapt-resume/sections.js";
import type { VacancyTerms } from "@/domain/adapt-resume/terms.js";
import { collectTerms, tokenize } from "@/domain/adapt-resume/terms.js";

/** Минимальный вес секции, чтобы считать её релевантной (1 сильный термин или 2 слабых). */
const MIN_SCORE = 1;

export interface AdaptResumeOptions {
  /** Лимит символов на адаптированный текст (по умолчанию DEFAULT_ADAPT_BUDGET). */
  budgetChars?: number;
}

/**
 * Адаптировать можно только непустой текст: PDF уходит в промпт отдельным блоком.
 * Правило одно и для сервисов (какой блок показывать), и для самого отбора секций.
 */
export function canAdaptResume(resume: Resume | null): resume is Resume & { text: string } {
  return Boolean(resume && resume.type === "text" && resume.text?.trim());
}

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
  if (!canAdaptResume(resume)) return null;

  const text = resume.text.replace(/\r\n/g, "\n").trim();
  if (!text) return null;

  const budget = adaptBudget(options.budgetChars);
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

/** Обрезает текст по бюджету, стараясь завершиться на границе строки или предложения. */
function clip(text: string, budget: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= budget) return trimmed;
  const cut = trimmed.slice(0, budget);
  const at = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return (at > budget * 0.6 ? cut.slice(0, at) : cut).trim();
}
