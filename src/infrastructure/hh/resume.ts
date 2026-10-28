// Разбор резюме из initial state hh.ru и приведение к стабильной модели.
// Структура страниц hh.ru меняется (как и у вакансий, см. hh-client.ts), поэтому
// объект резюме ищется «по форме»: hash + блоки опыта/образования/навыков, а не по
// жёсткому пути initialState.resumeView.resume. Это позволяет пережить переезд
// данных в другую обёртку без правки кода.

// Типы резюме объявлены в доменной модели (domain/models.ts) — их использует
// рендер Markdown. Реэкспорт сохраняет прежний путь импорта для адаптеров hh.ru.
import type {
  HhResumeCertificate,
  HhResumeContacts,
  HhResumeData,
  HhResumeEducation,
  HhResumeEducationItem,
  HhResumeExperience,
  HhResumeLanguage,
  HhResumeSalary,
  HhResumeSummary,
} from "@/domain/models.js";

export type {
  HhResumeCertificate,
  HhResumeContacts,
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

const translateEmployment = codeTranslator(EMPLOYMENT_LABELS);
const translateSchedule = codeTranslator(SCHEDULE_LABELS);
const translateWorkFormat = codeTranslator(WORK_FORMAT_LABELS);

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

const translateEmploymentForm = codeTranslator(EMPLOYMENT_FORM_LABELS);
const translateBusinessTrip = codeTranslator(BUSINESS_TRIP_LABELS);
const translateRelocation = codeTranslator(RELOCATION_LABELS);
const translateLanguageDegree = codeTranslator(LANGUAGE_DEGREE_LABELS);

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

// Поля резюме в initial state hh завёрнуты по одному: [{ string: "Павел" }],
// [{ date: "1991-10-18" }], [{ string: 113 }]. Разворачиваем такие обёртки, а объекты
// с несколькими ключами (опыт, телефон, контакт) оставляем как есть.
const SCHEME_WRAPPER_KEYS = new Set(['string', 'date', 'id', 'number', 'boolean', 'url']);

function unwrapValue(value: any): any {
  if (!Array.isArray(value)) return value;
  const items = value.map(item => {
    if (!isObject(item)) return item;
    const keys = Object.keys(item);
    if (keys.length !== 1 || !SCHEME_WRAPPER_KEYS.has(keys[0])) return item;
    return item[keys[0]];
  });
  return items.length === 1 ? items[0] : items;
}

/** Название региона: числовой id без справочника локацией не считаем. */
function placeName(value: any): string | null {
  const text = asText(value);
  return text && !/^\d+$/.test(text) ? text : null;
}

/** Один код → текст (регистр и разделители не важны); неизвестный код остаётся как есть. */
function translateCode(value: any, translate: (code: string) => string | null): string | null {
  const text = asText(value);
  if (!text) return null;
  return translate(text) || text;
}

/**
 * Список кодов → «A, B»: занятость, график и формат работы в резюме — массивы.
 * asText для массива вернул бы null, из-за чего блок молча терялся.
 */
function translateCodes(value: any, translate: (code: string) => string | null): string | null {
  const items = asArray(value)
    .map(item => translateCode(item, translate))
    .filter((item): item is string => Boolean(item));
  return items.length ? Array.from(new Set(items)).join(', ') : null;
}

function hashOf(value: any): string | null {
  // В схеме редактора hash лежит во вложенном _attributes.
  const hash = asString(pick(value, 'hash', 'resumeHash', 'resume_hash', 'id'))
    || asString(pick(value?._attributes, 'hash', 'resumeHash'));
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

/**
 * Полная дата (день рождения): dateStr схлопывает ISO до «03.1990», для периода
 * работы это верно, а для даты рождения теряется день.
 */
function fullDateStr(value: any): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
    return value.trim() || null;
  }
  if (isObject(value)) {
    const year = asNumber(pick(value, 'year'));
    const month = asNumber(pick(value, 'month'));
    const day = asNumber(pick(value, 'day'));
    if (year != null) {
      const parts = [day, month, year].filter((part): part is number => part != null);
      const last = parts.length - 1;
      return parts.map((part, index) => (index === last ? String(part) : String(part).padStart(2, '0'))).join('.');
    }
    return fullDateStr(pick(value, 'date', 'value', 'iso'));
  }
  return dateStr(value);
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

/** Код отрасли → текст из собранного словаря; без расшифровки оставляем код как есть. */
function industryLabel(value: any, labels?: Record<string, string>): string | null {
  const text = asText(value);
  if (!text) return null;
  return labels?.[text.toLowerCase().replace(/^industry\./, '')] || text;
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

function mapExperienceItem(item: any, industryLabels?: Record<string, string>): HhResumeExperience | null {
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
      .map(value => industryLabel(value, industryLabels))
      .filter((value): value is string => Boolean(value)),
  };
}

/**
 * Контакты резюме: плоские поля (phone/email/telegram) и список { type, value },
 * где тип приходит объектом ({ id: 'phone', name: 'Телефон' }) или строкой.
 */
function mapContacts(raw: any): HhResumeContacts {
  const phone = pick(raw, 'phone', 'phoneNumber', 'phone_number');
  const list = mapContactList(pick(raw, 'contacts', 'contact', 'contactList', 'contactsList'));
  const messengers = mapCommunicationMethods(pick(raw, 'communicationMethods', 'messengers'));

  return {
    // В схеме phone — объект с готовой строкой formatted, в API — просто строка.
    phone: asString(phone) || asString(pick(phone, 'formatted', 'value', 'number')) || list.phone || messengers.phone || null,
    email: asText(pick(raw, 'email', 'emailAddress', 'email_address')) || list.email || null,
    telegram: asText(pick(raw, 'telegram', 'telegramUsername', 'telegram_username'))
      || messengers.telegram || list.telegram || null,
  };
}

/**
 * Мессенджеры в схеме hh: объект { telegram: "@nick", whatsapp: "+7…" }
 * (в других формах — массив { type, value }).
 */
function mapCommunicationMethods(value: any): Partial<HhResumeContacts> {
  const found: Partial<HhResumeContacts> = {};
  if (isObject(value)) {
    for (const [type, inner] of Object.entries(value)) {
      const text = asText(inner);
      if (!text) continue;
      if (!found.telegram && /telegram|телег/i.test(type)) found.telegram = text;
      else if (!found.phone && /whatsapp|phone|тел/i.test(type)) found.phone = text;
    }
    return found;
  }
  return mapContactList(value);
}

/** Контакты из списка: тип ищется по названию («Телефон», «Эл. почта») и по коду. */
function mapContactList(value: any): Partial<HhResumeContacts> {
  const found: Partial<HhResumeContacts> = {};
  for (const item of asArray(value)) {
    if (!isObject(item)) continue;
    const text = asText(pick(item, 'value', 'text', 'title', 'url'));
    if (!text) continue;

    const type = pick(item, 'type', 'contactType');
    const kind = `${asText(type) || ''} ${asText(pick(type, 'id', 'code')) || ''}`.toLowerCase();
    if (!found.phone && /phone|тел/.test(kind)) found.phone = text;
    else if (!found.email && /mail|почт/.test(kind)) found.email = text;
    else if (!found.telegram && /telegram|телег/.test(kind)) found.telegram = text;
  }
  return found;
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

  const primary = Array.isArray(value) ? value : pick(value, 'primary', 'primaryEducation', 'items', 'list');
  const additional = Array.isArray(value) ? [] : pick(value, 'additional', 'additionalEducation', 'courses');

  return {
    primary: asArray(primary).map(mapEducationItem).filter((item): item is HhResumeEducationItem => Boolean(item)),
    additional: asArray(additional).map(mapEducationItem).filter((item): item is HhResumeEducationItem => Boolean(item)),
  };
}


/** Справочники, собранные из initialState: без них коды остаются кодами. */
export interface ResumeContext {
  /** «42» → «Бытовая химия…» для отраслей опыта. */
  industryLabels?: Record<string, string>;
  /** «higher» → «Высшее» для уровня образования. */
  educationLevels?: Record<string, string>;
  /** «113» → «Россия» — для гражданства (приходит кодом страны). */
  areaLabels?: Record<string, string>;
}

/** Языки: самый полный источник — resumeApplicantSkills (там же и степень владения). */
function mapLanguages(raw: any): HhResumeLanguage[] {
  const applicantSkills = asArray(pick(raw, 'resumeApplicantSkills', 'skillsWithLevels'));

  const withLevel = applicantSkills
    .filter(item => isObject(item) && (asString(pick(item, 'category')) || '').toUpperCase() === 'LANG')
    .map(item => ({ name: asText(pick(item, 'name')) || '', level: asText(pick(item, 'level')) }))
    .filter(item => Boolean(item.name));
  if (withLevel.length) return withLevel;

  // Фолбэк: пары { id языка, degree } — название берём из того же справочника по id.
  const names = new Map<string, string>();
  for (const item of applicantSkills) {
    if (!isObject(item)) continue;
    const name = asText(pick(item, 'name'));
    if (name) names.set(String(pick(item, 'id')), name);
  }
  return asArray(pick(raw, 'languages', 'languageList', 'language', 'languageKnowledge', 'foreignLanguages'))
    .map(item => ({
      name: asText(pick(item, 'name', 'language', 'title')) || names.get(String(pick(item, 'id'))) || '',
      level: translateCode(pick(item, 'degree', 'level'), translateLanguageDegree),
    }))
    .filter(item => Boolean(item.name));
}

/** Навыки: в схеме hh это массив [{ string }], в старом API — [{ name }]. */
function mapKeySkills(raw: any, aboutText: string | null): string[] {
  const source = pick(raw, 'keySkills', 'key_skills', 'advancedKeySkills', 'skillSet', 'professionalSkills', 'skillsList');
  const plain = pick(raw, 'skills');
  // В схеме редактора поле skills — это текст «О себе», а не список навыков.
  const candidates = source ?? (Array.isArray(plain) ? plain : null);

  return asArray(candidates)
    .flatMap(value => (typeof value === 'string' ? value.split(/[,;]/) : [value]))
    .map(asText)
    .filter((value): value is string => Boolean(value) && value !== aboutText);
}

/** Разворачивает обёртки схемы hh ({ string }, { date }) в плоские значения. */
export function unwrapResume(raw: any): any {
  if (!isObject(raw)) return raw;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = key.startsWith('_') ? value : unwrapValue(value);
  }
  return out;
}

/** Приводит найденный объект к модели, не зависящей от формы initial state. */
export function normalizeResume(raw: any, hashHint: string, context: ResumeContext = {}): HhResumeData {
  const hash = hashOf(raw) || hashHint;
  const workFormats = asArray(pick(raw, 'workFormats', 'work_format', 'workFormat'))
    .map(value => translateCode(value, translateWorkFormat))
    .filter((value): value is string => Boolean(value));
  // Уровень образования лежит либо отдельным полем, либо внутри блока education.
  const educationRaw = pick(raw, 'education', 'educations', 'educationList');
  const primaryEducation = pick(raw, 'primaryEducation');
  const educationLevelCode = asText(pick(raw, 'educationLevel', 'education_level'))
    || asText(isObject(educationRaw) ? pick(educationRaw, 'level', 'educationLevel') : null)
    || asText(pick(asArray(primaryEducation)[0], 'educationLevel'));

  // «О себе»: в схеме hh текст лежит в skills, а keySkills — это список навыков.
  const plainSkills = pick(raw, 'skills');
  const about = asString(pick(raw, 'about', 'aboutMe', 'selfAbout'))
    || (typeof plainSkills === 'string' ? plainSkills : null);

  return {
    hash,
    firstName: asText(pick(raw, 'firstName', 'first_name')),
    lastName: asText(pick(raw, 'lastName', 'last_name')),
    middleName: asText(pick(raw, 'middleName', 'middle_name')),
    title: asText(pick(raw, 'title', 'position', 'desiredPosition')),
    salary: mapSalary(pick(raw, 'salary', 'compensation')),
    area: placeName(pick(raw, 'area', 'location', 'city')),
    employment: translateCodes(pick(raw, 'employmentForms'), translateEmploymentForm)
      || translateCodes(pick(raw, 'employment', 'employmentForm', 'employmentType'), translateEmployment),
    schedule: translateCodes(pick(raw, 'workSchedule', 'schedule', 'workScheduleByDays'), translateSchedule),
    workFormats,
    businessTripReadiness: translateCode(pick(raw, 'businessTripReadiness', 'business_trip_readiness'), translateBusinessTrip),
    relocation: translateCode(pick(raw, 'relocation', 'relocationType'), translateRelocation),
    birthDate: fullDateStr(pick(raw, 'birthDate', 'birth_date', 'birthday', 'dateOfBirth', 'date_of_birth')),
    citizenship: asArray(pick(raw, 'citizenship', 'citizenships'))
      .map(value => {
        const text = asText(value);
        if (!text) return null;
        // Гражданство приходит кодом страны: без справочника «113» ничего не говорит.
        return /^\d+$/.test(text) ? (context.areaLabels?.[text] ?? null) : text;
      })
      .filter((value): value is string => Boolean(value)),
    contacts: mapContacts(raw),
    about,
    keySkills: mapKeySkills(raw, about),
    experience: asArray(pick(raw, 'experience', 'experienceList'))
      .map(item => mapExperienceItem(item, context.industryLabels))
      .filter((item): item is HhResumeExperience => Boolean(item)),
    education: mapEducation(educationRaw ?? {
      primary: primaryEducation,
      additional: pick(raw, 'additionalEducation', 'attestationEducation'),
    }),
    educationLevel: educationLevelCode
      ? (context.educationLevels?.[educationLevelCode] || educationLevelCode)
      : null,
    languages: mapLanguages(raw),
    certificates: asArray(pick(raw, 'certificates', 'certificateList', 'certificate'))
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
    birthDate: base.birthDate || extra.birthDate,
    citizenship: base.citizenship.length ? base.citizenship : extra.citizenship,
    contacts: {
      phone: base.contacts.phone || extra.contacts.phone,
      email: base.contacts.email || extra.contacts.email,
      telegram: base.contacts.telegram || extra.contacts.telegram,
    },
    about: base.about || extra.about,
    keySkills: base.keySkills.length ? base.keySkills : extra.keySkills,
    experience: base.experience.length ? base.experience : extra.experience,
    education: base.education.primary.length || base.education.additional.length ? base.education : extra.education,
    educationLevel: base.educationLevel || extra.educationLevel,
    languages: base.languages.length ? base.languages : extra.languages,
    certificates: base.certificates.length ? base.certificates : extra.certificates,
    rawText: base.rawText || extra.rawText,
    updatedAt: base.updatedAt || extra.updatedAt,
  };
}

