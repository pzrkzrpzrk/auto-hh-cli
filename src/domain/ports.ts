// Порты доменного слоя (DIP): хранилища, источники данных и файловый I/O.
// Домен зависит от этих узких интерфейсов, а не от конкретных модулей store/ (SQLite) или fs.
// Реализации подставляет composition root, поэтому сценарии можно прогонять с подставными
// портами — без базы, браузера и файловой системы.
import type {
  DigestEntry,
  HhResumeData,
  HhResumeSummary,
  Resume,
  ResumeRef,
  SearchEntry,
  SearchFileResult,
  Vacancy,
} from "@/domain/models.js";
import type { DigestFilterRules } from "@/domain/digest/types.js";
import type { SearchCacheSnapshot, SearchConfig } from "@/domain/search/types.js";
import type { VacancySource } from "@/domain/search/VacancySource.js";

export type { Logger } from "@/domain/logging.js";

/** Планировщик cron: сценарий не зависит от node-cron. */
export interface Scheduler {
  /** Проверить cron-выражение. */
  validate(expression: string): boolean;
  /** Поставить задачу; колбэк может быть async. */
  schedule(expression: string, fn: () => void | Promise<void>): void;
  /** Ближайшее срабатывание выражения; null — расчёт невозможен (как «неизвестно» в CLI). */
  nextRun(expression: string): Date | null;
}

/**
 * Конфигурация приложения — DTO из config.json. Описаны только секции, которые читают
 * сценарии; остальные ключи остаются на месте и доступны политикам/адаптерам.
 */
export interface AppConfig {
  api?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    [key: string]: unknown;
  };
  apply?: {
    coverLetterTemplate?: string;
    minClaudeScore?: number;
    maxPerRun?: number;
    dryRun?: boolean;
    [key: string]: unknown;
  };
  adaptResume?: boolean;
  /** Лимит символов на адаптированное резюме (по умолчанию DEFAULT_ADAPT_BUDGET). */
  adaptResumeBudget?: number;
  search?: SearchConfig;
  filter?: DigestFilterRules;
  schedule?: {
    cron?: string;
    steps?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Порт конфигурации (DIP): сценарий просит загрузить config.json по явному пути,
 * а не читает переменную CONFIG_PATH и диск сам. Путь по умолчанию выбирает адаптер.
 */
export interface ConfigProvider {
  load(path?: string): AppConfig;
}

/**
 * История откликов и просмотров — домену нужны только эти две операции:
 * узнать, что уже просмотрено (шаг сбора карточек), и пометить просмотренным.
 */
export interface HistoryStore {
  load(): Promise<HistoryState>;
  markSeen(vacancyId: string | number): Promise<void>;
  /** Отметка «взято в дайджест/отклик»: digest пишет digestOnly, apply — via=playwright. */
  markApplied(vacancyId: string | number, meta: HistoryMeta): Promise<void>;
}

/** Метаданные отклика: их пишут digest (digestOnly) и apply (via), читает `history`. */
export interface HistoryMeta {
  title?: string;
  employer?: string | null;
  url?: string | null;
  score?: number | null;
  digestOnly?: boolean;
  via?: string;
  /** Резюме, под которым реально отправлено сопроводительное (для join с реестром). */
  resumeId?: string | null;
  /** ISO-дата отметки; её добавляет хранилище при чтении. */
  at?: string;
  [key: string]: unknown;
}

/** Состояние истории: отклики по id и время последнего просмотра по id. */
export interface HistoryState {
  applied: Record<string, HistoryMeta>;
  seen: Record<string, string>;
}

/** Кэш поиска: чтение снимка (cachePages/cacheFull) и запись страниц и карточек. */
export interface CacheStore {
  /** Снимок кэша за дату (по умолчанию — сегодня) и, при необходимости, по резюме. */
  load(date?: Date, resumeId?: string): Promise<SearchCacheSnapshot>;
  savePage(state: SearchCacheSnapshot, pageNum: number | string, date?: Date): Promise<void>;
  saveFullVacancy(vacancy: Vacancy, date?: Date): Promise<void>;
  /** Полные карточки по id (cacheFull): карта vacancyId → вакансия. Нужна шагу cover. */
  getFullByVacancyIds(vacancyIds: (string | number)[]): Promise<Record<string, Vacancy>>;
}

/** Зависимости шагов сбора вакансий. */
export interface CollectDeps {
  cacheStore: CacheStore;
  history: HistoryStore;
}

// --- Файловый I/O сценариев ------------------------------------------------

/** Итог сброса данных: очищенные таблицы БД, файлы артефактов и кэш-файлы. */
export interface ResetSummary {
  db: { table: string; deleted: number }[];
  files: string[];
  cache: string[];
}

/**
 * Очистка данных CLI: файлы в data/ и таблицы SQLite.
 * Раскладку каталогов и список таблиц — детали адаптера, а не сценария.
 */
export interface DataJanitor {
  /** Полный сброс: история, кэш, дайджесты всех резюме (+ legacy-каталоги). */
  clearAll(): Promise<ResetSummary>;
  /**
   * Сброс данных одного резюме: его папка в data/hh-parsing, его дайджесты/rejected,
   * вердикты, письма и отклики. Общий кэш страниц/карточек — только по флагу
   * includeSearchCache (нужен шагу `search --reset`, который сразу перезапишет кэш).
   */
  clearResume(resume: ResumeRef, opts?: { includeSearchCache?: boolean }): Promise<ResetSummary>;
}

/** Файл резюме на диске: имя без расширения и имя файла с расширением. */
export interface ResumeFile {
  name: string;
  filename: string;
}

/** Файлы резюме: список, чтение и запись скачанного с hh.ru. */
export interface ResumeFiles {
  /** Каталог резюме, созданный при необходимости (для отчёта о сохранении). */
  ensureDir(): string;
  /** Доступные файлы резюме. */
  list(): ResumeFile[];
  /** Резюме по имени (без расширения) либо резюме по умолчанию. */
  load(name?: string): Resume | null;
  /** Путь файла резюме: `md` — Markdown, `pdf` — копия в подкаталоге pdf/. */
  pathFor(name: string, kind?: 'md' | 'pdf'): string;
  /** true, если файл уже существует. */
  exists(file: string): boolean;
  /** Записать .md; saved=false — файл уже был и overwrite выключен. */
  save(name: string, markdown: string, opts?: { overwrite?: boolean }): { file: string; saved: boolean };
}

/** Запись текстового артефакта (отчёт CLI): команда только печатает возвращённый путь. */
export interface TextFileWriter {
  /** Сохранить текст под именем `name` и вернуть путь (или имя) для печати. */
  save(name: string, text: string): string;
}

/**
 * Чтение резюме с диска: сценарии (grade, cover, digest) просят файл по имени,
 * а путь по умолчанию (RESUME_PATH / RESUMES_DIR) выбирает адаптер.
 */
export interface ResumeProvider {
  load(name?: string): Resume | null;
}

/** Запись выдачи поиска в .md: путь, формат и дедупликация — в адаптере. */
export interface SearchReportWriter {
  /** resume — чья папка в data/hh-parsing; без него выдача попадает в no-resume. */
  write(entries: SearchEntry[], opts?: { date?: string; query?: string; resume?: ResumeRef | null }): Promise<SearchFileResult[]>;
}

/** Зависимости сценария поиска: хранилища, конфиг, источник и файловые артефакты. */
export interface SearchDeps extends CollectDeps {
  config: ConfigProvider;
  source: SourceProvider<VacancySource>;
  /** Сброс данных перед поиском (`search --reset`). */
  janitor: DataJanitor;
  /** Куда стадия поиска пишет выдачу за день (папка выбранного резюме). */
  reportWriter: SearchReportWriter;
  /** Резюме нужно только для выбора папки артефактов; текст поиску не нужен. */
  resumeFiles: ResumeProvider;
}

// --- Источники hh.ru ------------------------------------------------------

/** Порт источника резюме соискателя: открыть сессию, список, карточка, PDF-копия. */
export interface ResumeSource {
  /** Открыть браузер заранее (идемпотентно: повторный вызов ничего не делает). */
  open(): Promise<void>;
  listMyResumes(): Promise<HhResumeSummary[]>;
  getMyResume(hash: string): Promise<HhResumeData | null>;
  downloadResumePdf(hash: string, destPath: string): Promise<string | null>;
}

/**
 * Фабрика с жизненным циклом (RAII): открыть источник → работа → закрыть.
 * Заменяет копии `const client = new HHClient(); try { ... } finally { client.close(); }`,
 * поэтому сценарии не знают ни про Playwright, ни про порядок закрытия браузера.
 */
export interface SourceProvider<T> {
  withSource<R>(fn: (source: T) => Promise<R>): Promise<R>;
}

// --- Отклик на вакансии ---------------------------------------------------

/** Итог одного отклика: reason нужен только для счётчика и лога сценария. */
export interface ApplyResult {
  ok: boolean;
  reason?: string;
  note?: string;
}

/**
 * Сессия отклика: браузер уже открыт, сценарий просит только «проверь вход» и «откликнись».
 * Как и ResumeSource, скрывает страницу, селекторы и ручные подтверждения.
 */
export interface ApplicationSession {
  ensureLoggedIn(): Promise<boolean>;
  apply(entry: DigestEntry): Promise<ApplyResult>;
}

/**
 * Провайдер сессии отклика (RAII): открыть браузер → работа → закрыть.
 * Тот же приём, что SourceProvider: сценарий не знает ни про Playwright, ни про порядок закрытия.
 */
export interface ApplicationGateway {
  withSession<R>(fn: (session: ApplicationSession) => Promise<R>): Promise<R>;
}

/** Ручной вход: headful-браузер, который живёт, пока пользователь его не закроет. */
export interface LoginGateway {
  login(): Promise<void>;
}

// --- ИИ-провайдер ---------------------------------------------------------

/** Сообщение модели: роль и содержимое (строка или блоки, как в OpenAI-совместимом API). */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | any[];
}

export interface AiChatOptions {
  messages: AiMessage[];
  /** Лимит токенов ответа; по умолчанию — AI_MAX_TOKENS. */
  maxTokens?: number;
  /** Просить строгий JSON (response_format=json_object). */
  json?: boolean;
  /** Метка для лога ретраев. */
  label?: string;
}

export interface AiChatResult {
  text: string | null;
  usage: { prompt?: number; completion?: number };
}

/**
 * Порт ИИ: домен просит «ответь на сообщения», не зная ни SDK, ни провайдера.
 * Ошибки пробрасываются — шаг сам решает, как их обработать.
 */
export interface AiProvider {
  chat(opts: AiChatOptions): Promise<AiChatResult>;
}

