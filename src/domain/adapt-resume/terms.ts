// Словарь терминов вакансии: алиасы технологий, стоп-слова и канонизация слов.
//
// Вынесено из адаптации резюме: и ранжирование секций, и отбор навыков пользуются
// одним правилом «слово → канонический токен».
import type { Vacancy } from "@/domain/models.js";
import { stripHtml } from "@/shared/text-utils.js";

/** Длина основы для кириллицы: «разработкой» и «разработчик» дают общий префикс. */
const RU_STEM_LEN = 5;

/** Термины вакансии с весами: strong — название и навыки, weak — описание. */
export interface VacancyTerms {
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

/** Термины вакансии: сильные (название, навыки) и слабые (описание). */
export function collectTerms(vacancy: Vacancy): VacancyTerms {
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
export function tokenize(text: string): string[] {
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
