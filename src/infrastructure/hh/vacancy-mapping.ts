// Приведение initial state hh.ru к формату прежнего API (Vacancy / VacancyListItem):
// остальной код не знает про vacancyId, company и коды вместо текста.
// Модуль чистый — без Playwright, сети и файлов.
import type { Vacancy } from "@/domain/models.js";
import type { VacancyListItem } from "@/domain/search/types.js";
import {
  decodeEntities,
  firstCode,
  isArchived,
  mapCompensation,
  objectName,
  toCodeList,
  toKeySkills,
  translateCode,
} from "@/infrastructure/hh/vacancy-fields.js";
import type { FieldsDictionary } from "@/infrastructure/hh/vacancy-fields.js";

// Краткая запись (как в search response старого API).
export function mapSearchItem(v: Record<string, any>): VacancyListItem {
  return {
    id: String(v.vacancyId),
    name: v.name,
    employer: v.company ? { name: v.company.visibleName || v.company.name, id: v.company.id } : null,
    area: v.area ? { id: v.area['@id'] ?? v.area.id ?? null, name: v.area.name } : null,
    salary: mapCompensation(v.compensation),
    alternate_url: v.links?.desktop || `https://hh.ru/vacancy/${v.vacancyId}`,
    snippet: v.snippet || null,
    archived: false,
    key_skills: [],
  };
}

// Полная запись (как в getVacancy старого API).
// opts.idHint — id из URL: в новой карточке нет поля id, есть vacancyId;
// opts.links — vacancyView.vacancyFull.links (в нём ссылка desktop);
// opts.translations — vacancyView.translations (в нём расшифровка workExperience);
// opts.fields — справочник кодов из vacancyFieldsDictionary (buildFieldsDictionary).
export interface MapVacancyOpts {
  idHint?: string | number | null;
  links?: { desktop?: string } | null;
  translations?: Record<string, any> | null;
  fields?: FieldsDictionary | null;
}

export function mapVacancyView(v: Record<string, any> | null, opts: MapVacancyOpts = {}): Vacancy | null {
  if (!v) return null;
  const rawId = v.vacancyId ?? v.id ?? opts.idHint ?? null;
  const fields = opts.fields || {};
  const employer = v.company || v.employer || null;

  // Опыт: «moreThan6» → «Более 6 лет». В vacancyFieldsDictionary опыта нет, поэтому сначала
  // пробуем справочник, затем translations.workExperience (там текст строкой).
  const experienceText = translateCode(fields, 'workExperience', firstCode(v.workExperience))
    || (typeof opts.translations?.workExperience === 'string' ? opts.translations.workExperience : null)
    || objectName(v.workExperience);

  const employmentCode = firstCode(v.employmentForm);
  const scheduleCodes = toCodeList(v.workScheduleByDays);
  // Формат работы — кодами (см. toCodeList), старое поле workFormat тоже поддержано.
  const workFormatCodes = toCodeList(v.workFormats ?? v.workFormat);

  return {
    id: String(rawId),
    name: decodeEntities(v.name ?? v.title),
    description: decodeEntities(v.description),
    employer: employer ? { name: employer.visibleName || employer.name, id: employer.id } : null,
    area: v.area ? { id: v.area['@id'] ?? v.area.id ?? v.area.regionId ?? null, name: v.area.name } : null,
    salary: mapCompensation(v.compensation ?? v.salary),
    key_skills: toKeySkills(v.keySkills ?? v.key_skills),
    experience: experienceText ? { name: experienceText } : null,
    schedule: scheduleCodes.length
      ? { name: scheduleCodes.map(c => translateCode(fields, 'workScheduleByDays', c) || c).join(', ') }
      : null,
    employment: employmentCode
      ? { name: translateCode(fields, 'employmentForm', employmentCode) || objectName(v.employmentForm) }
      : null,
    work_format: workFormatCodes,
    archived: isArchived(v),
    alternate_url: opts.links?.desktop || v.links?.desktop || `https://hh.ru/vacancy/${rawId}`,
    // Дата публикации на hh.ru (в прежнем API — created_at). Читает шаг digest.
    publishedAt: v.publicationDate
      || v.publicationTimeIso
      || (v.publicationTime && v.publicationTime['$'])
      || null,
  };
}
