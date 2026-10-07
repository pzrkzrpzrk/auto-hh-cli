export interface Vacancy {
  id: number | string;
  name: string;
  description: string;
  key_skills?: { name: string }[];
  salary?: { from?: number; to?: number; currency?: string };
  employer?: { name?: string };
  area?: { name: string, id: number };
  experience?: { name?: string };
  schedule?: { name?: string };
  employment?: { name?: string };
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

export interface JudgeOpts {
  minScore?: number;
  adaptResume?: boolean;
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

export interface DigestDoc {
  date: string;
  entries: DigestEntry[];
}

export interface DigestEntry {
  id: string;
  title: string;
  employer: string;
  area: string;
  salary: string;
  url: string;
  publishedAt?: string | null;
  score: number;
  reason: string | null;
  comment: string | null;
  coverLetter: string;
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
