// Поиск резюме в initial state hh.ru: сам объект резюме, список личного кабинета
// и справочники кодов, из которых собираются расшифровки.
// Модуль чистый: только обход JSON и эвристики «по форме».
import type { HhResumeSummary } from "@/domain/models.js";
import { INDUSTRY_CODE_RE, INDUSTRY_NUMBER_RE } from "@/infrastructure/hh/resume-codes.js";
import { asArray, asString, asText, hashOf, isObject, pick, walk } from "@/infrastructure/hh/resume-raw.js";

/**
 * Собирает расшифровку кодов отраслей из initial state.
 * В состоянии встречаются два вида: плоский словарь { "industry.42": "Бытовая химия…" }
 * и справочник под ключом industries/industry со списком { id, name }. Оба поддержаны:
 * иначе в Markdown попадал код («Отрасли: industry.5, industry.42»).
 */
export function collectIndustryLabels(state: any): Record<string, string> {
  const labels: Record<string, string> = {};

  // explicitOnly — вне справочника отраслей берём только коды с префиксом «industry.»:
  // числовые id в состоянии есть и у регионов/сфер, их текст к отраслям не относится.
  const put = (key: unknown, value: unknown, explicitOnly = true): void => {
    const raw = typeof key === 'string' || typeof key === 'number' ? String(key).trim().toLowerCase() : '';
    const explicit = INDUSTRY_CODE_RE.test(raw);
    if (!explicit && (explicitOnly || !INDUSTRY_NUMBER_RE.test(raw))) return;
    const text = asText(value);
    if (!text) return;
    const code = raw.replace(/^industry\./, '');
    if (!labels[code]) labels[code] = text;
  };

  walk(state, obj => {
    for (const [key, value] of Object.entries(obj)) {
      // Плоский словарь: { "industry.42": "…" }.
      if (typeof value === 'string') {
        put(key, value);
        continue;
      }
      // Справочник отраслей под ключом industries/industry: { "42": "…" },
      // { "industry.42": { name } } или [{ id, name }]. Числовые коды здесь допустимы:
      // ключ уже говорит, что это отрасли.
      if (!/^industr/i.test(key) || value == null || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isObject(item)) put(pick(item, 'id', 'code', 'key'), pick(item, 'name', 'title', 'text', 'value'), false);
        }
        continue;
      }
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, any>)) {
        put(innerKey, isObject(innerValue)
          ? pick(innerValue, 'name', 'title', 'text', 'value')
          : innerValue, false);
      }
    }
    // Элемент справочника: { id: "industry.42", name: "…" }.
    put(pick(obj, 'id', 'code', 'industryId'), pick(obj, 'name', 'title', 'text', 'visibleName'));
  });

  return labels;
}

/** Уровни образования из состояния: [{ value: "higher", text: "Высшее" }]. */
export function collectEducationLevels(state: any): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const item of asArray(pick(state, 'educationLevels'))) {
    if (!isObject(item)) continue;
    const value = asString(pick(item, 'value', 'id', 'code'));
    const text = asText(pick(item, 'text', 'name'));
    if (value && text) labels[value] = text;
  }
  return labels;
}

/**
 * Названия регионов и стран из самих данных резюме (companyAreaId + companyAreaTitle):
 * отдельного справочника стран на странице нет, а гражданство приходит только кодом.
 */
export function collectAreaLabels(state: any): Record<string, string> {
  const labels: Record<string, string> = {};
  walk(state, obj => {
    const id = pick(obj, 'companyAreaId', 'areaId');
    const title = asString(pick(obj, 'companyAreaTitle', 'areaTitle'));
    if (id != null && title && !labels[String(id)]) labels[String(id)] = title;
  });
  return labels;
}

/** Насколько объект похож на полное резюме. 0 — не похож. */
function resumeScore(obj: any): number {
  if (!isObject(obj)) return 0;
  let score = 0;
  if (hashOf(obj)) score += 3;
  if (Array.isArray(pick(obj, 'experience', 'experienceList'))) score += 4;
  if (pick(obj, 'education', 'educations', 'educationList', 'primaryEducation')) score += 3;
  if (Array.isArray(pick(obj, 'keySkills', 'key_skills', 'skills', 'advancedKeySkills', 'skillSet', 'professionalSkills', 'skillsList'))) score += 3;
  if (Array.isArray(pick(obj, 'languages', 'languageList', 'language', 'languageKnowledge', 'foreignLanguages'))) score += 1;
  if (pick(obj, 'employment', 'employmentForm', 'employmentType')) score += 1;
  if (pick(obj, 'contacts', 'contactList', 'phone', 'email')) score += 1;
  if (pick(obj, 'about')) score += 2;
  if (pick(obj, 'title', 'firstName', 'first_name', 'lastName', 'last_name')) score += 2;
  if (pick(obj, 'salary', 'compensation')) score += 1;
  return score;
}

/**
 * Ищет в initial state объект полного резюме.
 * Порог 7 отсекает вложенные блоки (опыт/образование), набирающие 3–5 баллов.
 */
export function findResumeObject(state: any): any | null {
  let best: any = null;
  let bestScore = 0;
  walk(state, obj => {
    const score = resumeScore(obj);
    if (score > bestScore) {
      best = obj;
      bestScore = score;
    }
  });
  return bestScore >= 7 ? best : null;
}

/** Ищет в initial state массив резюме личного кабинета. */
export function findResumeList(state: any): HhResumeSummary[] {
  let best: any[] = [];
  let bestScore = 0;

  // Признаки личного кабинета (статус, дата обновления, доступ) весят больше,
  // чем просто hash+title: так массив «похожих резюме» не перебьёт свой список.
  const scoreItem = (item: any): number => {
    let score = 1;
    if (pick(item, 'status', 'state')) score += 2;
    if (pick(item, 'updatedAt', 'updated_at', 'lastModified', 'modTime', 'publicationDate')) score += 2;
    if (pick(item, 'accessType', 'access')) score += 1;
    return score;
  };

  const consider = (arr: any[]) => {
    if (!Array.isArray(arr) || !arr.length) return;
    const matched = arr.filter(item => isObject(item) && hashOf(item) && (
      asText(pick(item, 'title', 'name', 'position')) || pick(item, 'status')
    ));
    if (matched.length < Math.ceil(arr.length * 0.75)) return;

    const score = matched.reduce((sum, item) => sum + scoreItem(item), 0);
    if (score > bestScore || (score === bestScore && matched.length > best.length)) {
      best = matched;
      bestScore = score;
    }
  };

  if (Array.isArray(state)) consider(state);
  walk(state, obj => {
    for (const value of Object.values(obj)) consider(value as any[]);
  });

  const seen = new Set<string>();
  return best
    .map(mapResumeSummary)
    .filter(item => {
      if (seen.has(item.hash)) return false;
      seen.add(item.hash);
      return true;
    });
}

function mapResumeSummary(item: any): HhResumeSummary {
  const hash = hashOf(item) as string;
  const nested = isObject(item?.resume) ? item.resume : {};
  const status = pick(item, 'status', 'state', 'accessType', 'access')
    ?? pick(nested, 'status', 'state', 'accessType', 'access');
  const published = pick(item, 'isPublished', 'published') ?? pick(nested, 'isPublished', 'published');

  return {
    hash,
    title: asText(pick(item, 'title', 'name', 'position'))
      || asText(pick(nested, 'title', 'name', 'position'))
      || [asText(pick(item, 'lastName', 'last_name')), asText(pick(item, 'firstName', 'first_name'))]
        .filter(Boolean).join(' ')
      || hash,
    status: asText(status)
      || (typeof published === 'boolean' ? (published ? 'Опубликовано' : 'Не опубликовано') : null),
    updatedAt: asString(pick(item, 'updatedAt', 'updated_at', 'lastModified', 'modTime', 'publicationDate')),
    url: asString(item?.links?.desktop)
      || asString(pick(item, 'url', 'alternateUrl', 'alternate_url'))
      || `https://hh.ru/resume/${hash}`,
  };
}
