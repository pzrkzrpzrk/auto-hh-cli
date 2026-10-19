// Порты хранилищ для доменного слоя (DIP).
// Домен зависит от этих узких интерфейсов, а не от конкретных модулей store/ (MongoDB).
// Реализации подставляет вызывающий код (CLI — временный composition root), поэтому
// доменные шаги можно прогонять с подставными хранилищами, без базы.
import type { HhResumeData, HhResumeSummary } from "./models.js";

/**
 * История откликов и просмотров — домену нужны только эти две операции:
 * узнать, что уже просмотрено (шаг сбора карточек), и пометить просмотренным.
 */
export interface HistoryStore {
  load(): Promise<{ applied: Record<string, any>; seen: Record<string, string> }>;
  markSeen(vacancyId: string | number): Promise<void>;
}

/** Кэш поиска: запись страниц выдачи (cachePages) и полных карточек (cacheFull). */
export interface CacheStore {
  savePage(state: any, pageNum: number | string, date?: Date): Promise<void>;
  saveFullVacancy(vacancy: any, date?: Date): Promise<void>;
}

/** Зависимости шагов сбора вакансий. */
export interface CollectDeps {
  cacheStore: CacheStore;
  history: HistoryStore;
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

