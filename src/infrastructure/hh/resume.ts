// Разбор резюме из initial state hh.ru и приведение к стабильной модели.
// Структура страниц hh.ru меняется (как и у вакансий, см. hh-client.ts), поэтому
// объект резюме ищется «по форме»: hash + блоки опыта/образования/навыков, а не по
// жёсткому пути initialState.resumeView.resume. Это позволяет пережить переезд
// данных в другую обёртку без правки кода.

// Типы резюме объявлены в доменной модели (domain/models.ts) — их использует
// рендер Markdown. Реэкспорт сохраняет прежний путь импорта для адаптеров hh.ru.
import type {
  HhResumeCertificate,
  HhResumeData,
  HhResumeEducation,
  HhResumeEducationItem,
  HhResumeExperience,
  HhResumeLanguage,
  HhResumeSalary,
  HhResumeSummary,
} from "../../domain/models.js";

export type {
  HhResumeCertificate,
  HhResumeData,
  HhResumeEducation,
  HhResumeEducationItem,
  HhResumeExperience,
  HhResumeLanguage,
  HhResumeSalary,
  HhResumeSummary,
};

// hash резюме на hh.ru — 40 hex-символов; 16 — запас на случай смены длины.
const HASH_RE = /^[0-9a-f]{16,}$/i;

// Коды hh.ru → человекочитаемый текст. Нужны, когда в состоянии лежит код,
// а расшифровки рядом нет (в вакансиях для этого есть vacancyFieldsDictionary).
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

function isObject(value: any): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: any, ...keys: string[]): any {
  if (!isObject(obj)) return null;
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  return null;
}

/** object | строка | число → строка (для полей hh, где текст бывает в name/title/visibleName). */
function asText(value: any): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (isObject(value)) {
    return asText(value.name ?? value.title ?? value.text ?? value.visibleName ?? value.type?.name ?? value.id);
  }
  return null;
}

function asString(value: any): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function asNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

/** Код из справочника → текст, иначе исходная строка. */
function label(value: any, dictionary?: Record<string, string>): string | null {
  const text = asText(value);
  if (!text) return null;
  return dictionary?.[text] || text;
}

function hashOf(value: any): string | null {
  const hash = asString(pick(value, 'hash', 'resumeHash', 'resume_hash', 'id'));
  return hash && HASH_RE.test(hash) ? hash : null;
}

function dateStr(value: any): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[2]}.${iso[1]}`;
    if (/^\d{4}$/.test(value)) return value;
    return value.trim() || null;
  }
  if (typeof value === 'number') return String(value);
  if (isObject(value)) {
    const year = asNumber(pick(value, 'year'));
    const month = asNumber(pick(value, 'month'));
    if (year != null) return month != null ? `${String(month).padStart(2, '0')}.${year}` : String(year);
    return dateStr(pick(value, 'date', 'value', 'iso'));
  }
  return null;
}

/** Обход JSON без рекурсии в глубину больше limit: initialState бывает большим. */
function walk(value: any, visit: (obj: any) => void, depth = 0, limit = 12): void {
  if (value == null || depth > limit) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1, limit);
    return;
  }
  if (!isObject(value)) return;
  visit(value);
  for (const item of Object.values(value)) walk(item, visit, depth + 1, limit);
}

/** Насколько объект похож на полное резюме. 0 — не похож. */
function resumeScore(obj: any): number {
  if (!isObject(obj)) return 0;
  let score = 0;
  if (hashOf(obj)) score += 3;
  if (Array.isArray(pick(obj, 'experience', 'experienceList'))) score += 4;
  if (pick(obj, 'education')) score += 3;
  if (Array.isArray(pick(obj, 'keySkills', 'key_skills', 'skills'))) score += 3;
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


function mapSalary(value: any): HhResumeSalary | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return { amount: value, from: null, to: null, currency: null };
  }
  if (!isObject(value)) return null;

  const amount = asNumber(pick(value, 'amount', 'value'));
  const from = asNumber(pick(value, 'from'));
  const to = asNumber(pick(value, 'to'));
  if (amount == null && from == null && to == null) return null;

  return {
    amount,
    from,
    to,
    currency: asText(pick(value, 'currency', 'currencyCode', 'currency_code')),
  };
}

function mapExperienceItem(item: any): HhResumeExperience | null {
  if (!isObject(item)) return null;
  const company = asText(pick(item, 'company', 'companyName', 'employer'));
  const position = asText(pick(item, 'position', 'jobTitle', 'name'));
  if (!company && !position) return null;

  return {
    company,
    position,
    start: dateStr(pick(item, 'start', 'startDate', 'dateFrom')),
    end: dateStr(pick(item, 'end', 'endDate', 'dateTo')),
    description: asString(pick(item, 'description', 'additionalInfo')),
    industries: asArray(pick(item, 'industries', 'industry'))
      .map(asText)
      .filter((value): value is string => Boolean(value)),
  };
}

function mapEducationItem(item: any): HhResumeEducationItem | null {
  if (!isObject(item)) return null;

  const organization = asText(pick(item, 'organization', 'faculty', 'department'));
  const institution = asText(pick(item, 'name', 'university', 'institution')) || organization;

  const result = {
    institution,
    faculty: organization && organization !== institution ? organization : null,
    specialty: asText(pick(item, 'result', 'specialty', 'degree')),
    year: dateStr(pick(item, 'year', 'endYear', 'graduationYear')),
  };
  return result.institution || result.specialty || result.year ? result : null;
}

function mapEducation(value: any): HhResumeEducation {
  const empty: HhResumeEducation = { primary: [], additional: [] };
  if (value == null) return empty;

  const primary = Array.isArray(value) ? value : pick(value, 'primary', 'primaryEducation', 'items');
  const additional = Array.isArray(value) ? [] : pick(value, 'additional', 'additionalEducation', 'courses');

  return {
    primary: asArray(primary).map(mapEducationItem).filter((item): item is HhResumeEducationItem => Boolean(item)),
    additional: asArray(additional).map(mapEducationItem).filter((item): item is HhResumeEducationItem => Boolean(item)),
  };
}


/** Приводит найденный объект к модели, не зависящей от формы initial state. */
export function normalizeResume(raw: any, hashHint: string): HhResumeData {
  const hash = hashOf(raw) || hashHint;
  const workFormats = asArray(pick(raw, 'workFormats', 'work_format', 'workFormat'))
    .map(value => label(value, WORK_FORMAT_LABELS))
    .filter((value): value is string => Boolean(value));

  return {
    hash,
    firstName: asText(pick(raw, 'firstName', 'first_name')),
    lastName: asText(pick(raw, 'lastName', 'last_name')),
    middleName: asText(pick(raw, 'middleName', 'middle_name')),
    title: asText(pick(raw, 'title', 'position', 'desiredPosition')),
    salary: mapSalary(pick(raw, 'salary', 'compensation')),
    area: asText(pick(raw, 'area', 'location', 'city')),
    employment: label(pick(raw, 'employment', 'employmentForm'), EMPLOYMENT_LABELS),
    schedule: label(pick(raw, 'schedule', 'workScheduleByDays'), SCHEDULE_LABELS),
    workFormats,
    businessTripReadiness: asText(pick(raw, 'businessTripReadiness', 'business_trip_readiness')),
    relocation: asText(pick(raw, 'relocation', 'relocationType')),
    about: asString(pick(raw, 'about', 'aboutMe', 'selfAbout')),
    keySkills: asArray(pick(raw, 'keySkills', 'key_skills', 'skills'))
      .map(asText)
      .filter((value): value is string => Boolean(value)),
    experience: asArray(pick(raw, 'experience', 'experienceList'))
      .map(mapExperienceItem)
      .filter((item): item is HhResumeExperience => Boolean(item)),
    education: mapEducation(pick(raw, 'education')),
    languages: asArray(pick(raw, 'languages', 'languageList'))
      .map(item => ({
        name: asText(pick(item, 'name')) || '',
        level: asText(pick(item, 'level', 'degree')),
      }))
      .filter(item => Boolean(item.name)),
    certificates: asArray(pick(raw, 'certificates', 'certificateList'))
      .map(item => ({
        title: asText(pick(item, 'title', 'name')) || '',
        owner: asText(pick(item, 'owner', 'organization')),
        issued: dateStr(pick(item, 'issued', 'year')),
        url: asString(pick(item, 'url')),
      }))
      .filter(item => Boolean(item.title)),
    rawText: null,
    updatedAt: asString(pick(raw, 'updatedAt', 'updated_at', 'lastModified', 'modTime')),
    url: `https://hh.ru/resume/${hash}`,
  };
}

/** true, если из состояния не удалось вытащить ничего содержательного. */
export function isEmptyResume(data: HhResumeData | null | undefined): boolean {
  if (!data) return true;
  return !data.title
    && !data.about
    && !data.keySkills.length
    && !data.experience.length
    && !data.education.primary.length
    && !data.education.additional.length
    && !data.rawText;
}

/** Дополняет данные из initial state тем, что удалось прочитать из DOM. */
export function mergeResume(base: HhResumeData | null, extra: HhResumeData | null): HhResumeData | null {
  if (!base) return extra;
  if (!extra) return base;

  return {
    ...base,
    firstName: base.firstName || extra.firstName,
    lastName: base.lastName || extra.lastName,
    middleName: base.middleName || extra.middleName,
    title: base.title || extra.title,
    salary: base.salary || extra.salary,
    area: base.area || extra.area,
    employment: base.employment || extra.employment,
    schedule: base.schedule || extra.schedule,
    workFormats: base.workFormats.length ? base.workFormats : extra.workFormats,
    businessTripReadiness: base.businessTripReadiness || extra.businessTripReadiness,
    relocation: base.relocation || extra.relocation,
    about: base.about || extra.about,
    keySkills: base.keySkills.length ? base.keySkills : extra.keySkills,
    experience: base.experience.length ? base.experience : extra.experience,
    education: base.education.primary.length || base.education.additional.length ? base.education : extra.education,
    languages: base.languages.length ? base.languages : extra.languages,
    certificates: base.certificates.length ? base.certificates : extra.certificates,
    rawText: base.rawText || extra.rawText,
    updatedAt: base.updatedAt || extra.updatedAt,
  };
}

