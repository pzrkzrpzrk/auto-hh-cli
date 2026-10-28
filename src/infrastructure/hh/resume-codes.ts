// Коды hh.ru → человекочитаемый текст для резюме. Нужны, когда в состоянии лежит
// код, а расшифровки рядом нет (в вакансиях для этого есть vacancyFieldsDictionary).
// Модуль чистый: словари и переводчики без состояния.
import { asArray, asText } from "@/infrastructure/hh/resume-raw.js";

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL: 'Полная занятость',
  PART: 'Частичная занятость',
  PROJECT: 'Проектная работа',
  VOLUNTEER: 'Волонтёрство',
  PROBATION: 'Стажировка',
};

const SCHEDULE_LABELS: Record<string, string> = {
  FULL_DAY: 'Полный день',
  SHIFT: 'Сменный график',
  FLEXIBLE: 'Гибкий график',
  REMOTE: 'Удалённая работа',
  FLY_IN_FLY_OUT: 'Вахта',
  FIVE_ON_TWO_OFF: '5/2',
  TWO_ON_TWO_OFF: '2/2',
  THREE_ON_THREE_OFF: '3/3',
};

const WORK_FORMAT_LABELS: Record<string, string> = {
  ON_SITE: 'На месте работодателя',
  REMOTE: 'Удалённо',
  HYBRID: 'Гибрид',
  FIELD_WORK: 'Разъездная работа',
};

// Коды отраслей в резюме выглядят как «industry.42» (или 42): текст для них лежит
// в первоначальном состоянии страницы, а не в открытом справочнике, поэтому
// расшифровка собирается обходом состояния — см. collectIndustryLabels.
const INDUSTRY_CODE_RE = /^industry\.\d+(?:\.\d+)?$/i;
const INDUSTRY_NUMBER_RE = /^\d+(?:\.\d+)?$/;

// Одно и то же понятие hh присылает в разном виде: FULL_DAY, fullDay, full-day.
// Поэтому ключи словарей сравниваем без разделителей и регистра.
function codeKey(code: string): string {
  return code.replace(/[\s_-]+/g, '').toUpperCase();
}

function codeTranslator(dict: Record<string, string>): (code: string) => string | null {
  const byKey = new Map<string, string>();
  for (const [key, value] of Object.entries(dict)) byKey.set(codeKey(key), value);
  return code => byKey.get(codeKey(code)) ?? null;
}

// «Тип занятости» на hh — это employmentForms (Постоянная работа / Подработка),
// а employment — более старый набор кодов (полная/частичная занятость).
const EMPLOYMENT_FORM_LABELS: Record<string, string> = {
  FULL: 'Постоянная работа',
  PART_TIME: 'Подработка',
  PROJECT: 'Проектная работа',
  VOLUNTEER: 'Волонтёрство',
  PROBATION: 'Стажировка',
};

const BUSINESS_TRIP_LABELS: Record<string, string> = {
  ready: 'Готов к командировкам',
  sometimes: 'Готов к редким командировкам',
  never: 'Не готов к командировкам',
};

const RELOCATION_LABELS: Record<string, string> = {
  relocation_possible: 'Готов к переезду',
  relocation_possible_after_some_time: 'Готов к переезду со временем',
  relocation_not_possible: 'Не готов к переезду',
};

// Степени владения языком: l1 — родной, остальные — уровни CEFR.
const LANGUAGE_DEGREE_LABELS: Record<string, string> = {
  l1: 'Родной',
  a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2', c1: 'C1', c2: 'C2',
};

export const translateEmployment = codeTranslator(EMPLOYMENT_LABELS);
export const translateSchedule = codeTranslator(SCHEDULE_LABELS);
export const translateWorkFormat = codeTranslator(WORK_FORMAT_LABELS);
export const translateEmploymentForm = codeTranslator(EMPLOYMENT_FORM_LABELS);
export const translateBusinessTrip = codeTranslator(BUSINESS_TRIP_LABELS);
export const translateRelocation = codeTranslator(RELOCATION_LABELS);
export const translateLanguageDegree = codeTranslator(LANGUAGE_DEGREE_LABELS);

/** Один код → текст (регистр и разделители не важны); неизвестный код остаётся как есть. */
export function translateCode(value: any, translate: (code: string) => string | null): string | null {
  const text = asText(value);
  if (!text) return null;
  return translate(text) || text;
}

/**
 * Список кодов → «A, B»: занятость, график и формат работы в резюме — массивы.
 * asText для массива вернул бы null, из-за чего блок молча терялся.
 */
export function translateCodes(value: any, translate: (code: string) => string | null): string | null {
  const items = asArray(value)
    .map(item => translateCode(item, translate))
    .filter((item): item is string => Boolean(item));
  return items.length ? Array.from(new Set(items)).join(', ') : null;
}

/** Код отрасли → текст из собранного словаря; без расшифровки оставляем код как есть. */
export function industryLabel(value: any, labels?: Record<string, string>): string | null {
  const text = asText(value);
  if (!text) return null;
  return labels?.[text.toLowerCase().replace(/^industry\./, '')] || text;
}

export { INDUSTRY_CODE_RE, INDUSTRY_NUMBER_RE };
