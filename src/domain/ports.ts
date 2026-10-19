// Порты хранилищ для доменного слоя (DIP).
// Домен зависит от этих узких интерфейсов, а не от конкретных модулей store/ (MongoDB).
// Реализации подставляет вызывающий код (CLI — временный composition root), поэтому
// доменные шаги можно прогонять с подставными хранилищами, без базы.
import type { DigestEntry, HhResumeData, HhResumeSummary, Vacancy } from "./models.js";
import type { SearchCacheSnapshot } from "./search/types.js";
import type { VacancySource } from "./search/VacancySource.js";

/**
 * История откликов и просмотров — домену нужны только эти две операции:
 * узнать, что уже просмотрено (шаг сбора карточек), и пометить просмотренным.
 */
export interface HistoryStore {
  load(): Promise<{ applied: Record<string, any>; seen: Record<string, string> }>;
  markSeen(vacancyId: string | number): Promise<void>;
  /** Отметка «взято в дайджест/отклик»: digest пишет digestOnly, apply — via=playwright. */
  markApplied(vacancyId: string | number, meta: Record<string, any>): Promise<void>;
}

/** Кэш поиска: чтение снимка (cachePages/cacheFull) и запись страниц и карточек. */
export interface CacheStore {
  /** Снимок кэша за дату (по умолчанию — сегодня) и, при необходимости, по резюме. */
  load(date?: Date, resumeId?: string): Promise<SearchCacheSnapshot>;
  savePage(state: any, pageNum: number | string, date?: Date): Promise<void>;
  saveFullVacancy(vacancy: any, date?: Date): Promise<void>;
  /** Полные карточки по id (cacheFull): карта vacancyId → вакансия. Нужна шагу cover. */
  getFullByVacancyIds(vacancyIds: (string | number)[]): Promise<Record<string, Vacancy>>;
}

/** Зависимости шагов сбора вакансий. */
export interface CollectDeps {
  cacheStore: CacheStore;
  history: HistoryStore;
}

/** Зависимости сценария поиска: хранилища + источник вакансий с жизненным циклом. */
export interface SearchDeps extends CollectDeps {
  source: SourceProvider<VacancySource>;
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

