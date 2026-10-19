// Адаптация резюме под конкретную вакансию.
// Оставляет только секции, релевантные для данной вакансии — по совпадению ключевых
// терминов (название, навыки, описание). Если ни одна секция не подошла — не адаптирует.
import { stripHtml } from "../shared/text-utils.js";
import type { Resume, Vacancy } from "./models.js";

export function adaptResumeForVacancy(resume: Resume | null, vacancy: Vacancy): string | null {
  if (!resume || resume.type === "pdf" || !resume.text) return null;

  const keyTerms = collectKeyTerms(vacancy);
  if (keyTerms.length === 0) return null;

  // Разделяем по markdown-заголовкам (# ## ###) или пустым строкам
  const sections = resume.text.split(/\n(?=#{1,3}\s)/);

  const relevant = sections.filter((section: string) => {
    const lower = section.toLowerCase();
    return keyTerms.some((t) => lower.includes(t));
  });

  if (relevant.length === 0) return null;
  return relevant.join("\n");
}

function collectKeyTerms(vacancy: Vacancy): string[] {
  const terms = new Set<string>();

  if (vacancy.name) addWords(terms, vacancy.name);

  if (vacancy.key_skills) {
    for (const s of vacancy.key_skills) {
      if (s.name) terms.add(s.name.toLowerCase().trim());
    }
  }

  if (vacancy.description) {
    addWords(terms, stripHtml(vacancy.description));
  }

  return Array.from(terms);
}

function addWords(set: Set<string>, text: string): void {
  for (const w of text.split(/[\s,;:.!?()]+/)) {
    const clean = w.replace(/[^a-zA-Zа-яА-Я0-9#.+]/g, "").trim();
    if (clean.length > 2) set.add(clean.toLowerCase());
  }
}
