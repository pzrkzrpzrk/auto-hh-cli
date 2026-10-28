// Разбор отдельных блоков резюме: зарплата, опыт, контакты, образование, языки, навыки.
// Каждый маппер терпим к форме initial state и возвращает null/пустое, если данных нет.
import type {
  HhResumeContacts,
  HhResumeEducation,
  HhResumeEducationItem,
  HhResumeExperience,
  HhResumeLanguage,
  HhResumeSalary,
} from "@/domain/models.js";
import { industryLabel, translateCode, translateLanguageDegree } from "@/infrastructure/hh/resume-codes.js";
import {
  asArray,
  asNumber,
  asString,
  asText,
  dateStr,
  isObject,
  pick,
} from "@/infrastructure/hh/resume-raw.js";

export function mapSalary(value: any): HhResumeSalary | null {
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

export function mapExperienceItem(item: any, industryLabels?: Record<string, string>): HhResumeExperience | null {
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
export function mapContacts(raw: any): HhResumeContacts {
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
export function mapCommunicationMethods(value: any): Partial<HhResumeContacts> {
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
export function mapContactList(value: any): Partial<HhResumeContacts> {
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

export function mapEducationItem(item: any): HhResumeEducationItem | null {
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

export function mapEducation(value: any): HhResumeEducation {
  const empty: HhResumeEducation = { primary: [], additional: [] };
  if (value == null) return empty;

  const primary = Array.isArray(value) ? value : pick(value, 'primary', 'primaryEducation', 'items', 'list');
  const additional = Array.isArray(value) ? [] : pick(value, 'additional', 'additionalEducation', 'courses');

  return {
    primary: asArray(primary).map(mapEducationItem).filter((item): item is HhResumeEducationItem => Boolean(item)),
    additional: asArray(additional).map(mapEducationItem).filter((item): item is HhResumeEducationItem => Boolean(item)),
  };
}

/** Языки: самый полный источник — resumeApplicantSkills (там же и степень владения). */
export function mapLanguages(raw: any): HhResumeLanguage[] {
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
export function mapKeySkills(raw: any, aboutText: string | null): string[] {
  const source = pick(raw, 'keySkills', 'key_skills', 'advancedKeySkills', 'skillSet', 'professionalSkills', 'skillsList');
  const plain = pick(raw, 'skills');
  // В схеме редактора поле skills — это текст «О себе», а не список навыков.
  const candidates = source ?? (Array.isArray(plain) ? plain : null);

  return asArray(candidates)
    .flatMap(value => (typeof value === 'string' ? value.split(/[,;]/) : [value]))
    .map(asText)
    .filter((value): value is string => Boolean(value) && value !== aboutText);
}
