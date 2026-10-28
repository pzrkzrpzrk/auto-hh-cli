// Приведение найденного объекта резюме к стабильной доменной модели: обёртки схемы hh,
// коды занятости/графика, слияние с DOM-фолбэком и проверка «пустого» результата.
// Модуль чистый — без Playwright, сети и файлов.
import type { HhResumeData, HhResumeExperience } from "@/domain/models.js";
import {
  translateBusinessTrip,
  translateCode,
  translateCodes,
  translateEmployment,
  translateEmploymentForm,
  translateRelocation,
  translateSchedule,
  translateWorkFormat,
} from "@/infrastructure/hh/resume-codes.js";
import {
  asArray,
  asString,
  asText,
  dateStr,
  fullDateStr,
  hashOf,
  isObject,
  pick,
  placeName,
  unwrapValue,
} from "@/infrastructure/hh/resume-raw.js";
import {
  mapContacts,
  mapEducation,
  mapExperienceItem,
  mapKeySkills,
  mapLanguages,
  mapSalary,
} from "@/infrastructure/hh/resume-sections.js";

/** Справочники, собранные из initialState: без них коды остаются кодами. */
export interface ResumeContext {
  /** «42» → «Бытовая химия…» для отраслей опыта. */
  industryLabels?: Record<string, string>;
  /** «higher» → «Высшее» для уровня образования. */
  educationLevels?: Record<string, string>;
  /** «113» → «Россия» — для гражданства (приходит кодом страны). */
  areaLabels?: Record<string, string>;
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
