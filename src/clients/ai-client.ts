import OpenAI from "openai";
import type { Resume } from "../types";

// Провайдер задаётся парой: config.json → api.baseUrl + api.model.
// Дефолт — GLM-4.7-Flash (Z.ai): бесплатная, 200K контекста, 128K вывода.
const DEFAULT_MODEL = 'glm-4.7-flash';
const DEFAULT_MAX_TOKENS = 32768;
const DEFAULT_CONCURRENCY = 10;

let client: OpenAI | null = null;
let lastConfig: any = null;

// Модель для судьи, писем и оценки резюме: api.model → CLAUDE_MODEL → дефолт.
export function getModel(apiConfig?: any): string {
  return apiConfig?.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

// Максимум токенов на один ответ. У thinking-моделей (GLM-4.7) часть лимита уходит
// на рассуждения, поэтому дефолт заметно выше ожидаемого объёма ответа.
export function getMaxTokens(): number {
  const n = parseInt(process.env.AI_MAX_TOKENS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

// Сколько ИИ-запросов выполнять параллельно: бесплатные тарифы часто ограничивают
// параллелизм, и при превышении приходят 429.
export function getConcurrency(): number {
  const n = parseInt(process.env.AI_CONCURRENCY || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONCURRENCY;
}

export function getClient(apiConfig?: any): OpenAI | null {
  const cfg = apiConfig || {};
  if (client && lastConfig === apiConfig) return client;

  const key = cfg.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  // Повторы на уровне SDK выключены: ретраями управляет retryOnTransient,
  // который видит 429/Retry-After и логирует попытки (иначе повторы множатся).
  const opts: Record<string, any> = { apiKey: key, maxRetries: 0 };
  const baseURL = process.env.OPENAI_BASE_URL || cfg.baseUrl;
  if (baseURL) opts.baseURL = baseURL;

  client = new OpenAI(opts);
  lastConfig = apiConfig;
  return client;
}

export function buildResumeBlock(resume: Resume, adaptedText: string | null = null): { type: string; text: string } | null {
  if (!resume) return null;
  if (adaptedText) {
    return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ (адаптированное под вакансию) ===\n${adaptedText}` };
  }
  if (resume.type === 'pdf') {
    return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ (PDF) ===\n${resume.filename}` };
  }
  return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ ===\n${resume.text}` };
}
