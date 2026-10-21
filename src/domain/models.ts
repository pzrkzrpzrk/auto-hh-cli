export interface Vacancy {
  id: number | string;
  name: string;
  description: string;
  key_skills?: { name: string }[] | null;
  salary?: { from?: number | null; to?: number | null; currency?: string | null } | null;
  employer?: { name?: string | null; id?: number | string | null } | null;
  area?: { name: string; id: number } | null;
  experience?: { name?: string | null } | null;
  schedule?: { name?: string | null } | null;
  employment?: { name?: string | null } | null;
  [key: string]: unknown;
}

export interface Verdict {
  vacancyId: string;
  fit: boolean;
  score: number;
  reason: string | null;
  comment: string | null;
  // Модель по контракту (judge/system-text.ts) возвращает пустую строку; поле читает
  // normalizeVerdict, поэтому объявлено в типе (иначе TS-ошибка TS2353).
  coverLetter?: string;
}

import type { Logger } from "@/domain/logging.js";

export interface JudgeOpts {
  minScore?: number;
  adaptResume?: boolean;
  /** Куда писать диагностику: домен не импортирует logger. */
  logger?: Logger;
  [key: string]: unknown;
}

export interface Resume {
  name: string;
  id: string;
  type: 'text' | 'pdf';
  text?: string;
  data?: string;
  filename: string;
}

/**
 * Ссылка на резюме для раскладки артефактов и ключей кэша.
 * name — имя файла без расширения (папка на диске), id — стабильный UUID.
 */
export interface ResumeRef {
  name: string;
  id: string;
}

// --- Резюме hh.ru ---------------------------------------------------------
// Модель страницы резюме (разбор — в адаптере hh.ru).
// Живёт в домене, потому что её использует рендер Markdown (domain/resume-markdown.ts)
// и правила адаптации резюме под вакансию (domain/adapt-resume.ts).

export interface HhResumeSalary {
  amount: number | null;
  from: number | null;
  to: number | null;
  currency: string | null;
}

export interface HhResumeExperience {
  company: string | null;
  position: string | null;
  start: string | null;
  end: string | null;
  description: string | null;
  industries: string[];
}

export interface HhResumeEducationItem {
  institution: string | null;
  faculty: string | null;
  specialty: string | null;
  year: string | null;
}

export interface HhResumeEducation {
  primary: HhResumeEducationItem[];
  additional: HhResumeEducationItem[];
}

export interface HhResumeLanguage {
  name: string;
  level: string | null;
}

export interface HhResumeCertificate {
  title: string;
  owner: string | null;
  issued: string | null;
  url: string | null;
}

export interface HhResumeData {
  hash: string;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  title: string | null;
  salary: HhResumeSalary | null;
  area: string | null;
  employment: string | null;
  schedule: string | null;
  workFormats: string[];
  businessTripReadiness: string | null;
  relocation: string | null;
  about: string | null;
  keySkills: string[];
  experience: HhResumeExperience[];
  education: HhResumeEducation;
  languages: HhResumeLanguage[];
  certificates: HhResumeCertificate[];
  // Сырой текст страницы — последний фолбэк, если structured-блоки не распознаны.
  rawText: string | null;
  updatedAt: string | null;
  url: string;
}

export interface HhResumeSummary {
  hash: string;
  title: string;
  status: string | null;
  updatedAt: string | null;
  url: string;
}

export interface DigestDoc {
  date: string;
  entries: DigestEntry[];
  /** Резюме, под которым собран дайджест (null/undefined — legacy-документ). */
  resumeId?: string | null;
  /** Имя файла резюме без расширения — нужно для папки на диске. */
  resumeName?: string | null;
  /** Время последней записи документа (ISO): tie-break для latest между резюме. */
  updatedAt?: string | null;
}

export interface DigestEntry {
  id: string;
  title: string;
  employer: string;
  area: string;
  salary: string;
  url: string;
  publishedAt?: string | null;
  score: number | null;
  reason: string | null;
  comment: string | null;
  coverLetter: string;
  /** Резюме, под которым вакансия отобрана и оценена (digest). */
  resumeId?: string | null;
  /** Резюме, под которым сгенерировано сопроводительное (cover). */
  coverLetterResumeId?: string | null;
  // Актуализация (шаг `digest actualize`): помечается по наличию в последнем поиске.
  // archived — вакансии больше нет в выдаче; lastSeenAt — дата поиска, где встречалась последний раз.
  archived?: boolean;
  lastSeenAt?: string | null;
  checkedAt?: string | null;
}

// Строка выдачи поиска для .md-файла (data/search/) — те же поля, что у элемента cachePages.
export interface SearchEntry {
  id: string;
  title: string;
  employer: string;
  area: string;
  salary: string;
  url?: string;
}

// Результат дозаписи выдачи в data/search/: added — сколько новых вакансий дописано,
// total — сколько всего в файле за день.
export interface SearchFileResult {
  file: string;
  added: number;
  total: number;
}
