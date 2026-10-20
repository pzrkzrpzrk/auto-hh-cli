import OpenAI from "openai";
import type { AiProvider, AiChatOptions, AiChatResult } from "../../domain/ports.js";
import { retryOnTransient } from "../../shared/retry.js";
import { positiveIntFromEnv } from "../config/env.js";

// Провайдер задаётся парой: config.json → api.baseUrl + api.model.
// Дефолт — GLM-4.7-Flash (Z.ai): бесплатная, 200K контекста, 128K вывода.
const DEFAULT_MODEL = 'glm-4.7-flash';
const DEFAULT_MAX_TOKENS = 32768;

// Настройки повторов читает адаптер (shared/retry больше не знает про env).
const RETRY_DEFAULTS = {
  attempts: positiveIntFromEnv('AI_RETRY_ATTEMPTS', 5),
  baseDelayMs: positiveIntFromEnv('AI_RETRY_BASE_MS', 1000),
  maxDelayMs: positiveIntFromEnv('AI_RETRY_MAX_MS', 30000),
};

let client: OpenAI | null = null;
let lastConfig: any = null;

// Модель для судьи, писем и оценки резюме: api.model → CLAUDE_MODEL → дефолт.
export function getModel(apiConfig?: any): string {
  return apiConfig?.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

// Максимум токенов на один ответ. У thinking-моделей (GLM-4.7) часть лимита уходит
// на рассуждения, поэтому дефолт заметно выше ожидаемого объёма ответа.
export function getMaxTokens(): number {
  return positiveIntFromEnv('AI_MAX_TOKENS', DEFAULT_MAX_TOKENS);
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

/**
 * Адаптер OpenAI-совместимого API (Z.ai, DeepSeek, OpenAI, …) — единственное место,
 * где домен упирается в SDK. Домен видит только порт AiProvider: провайдера можно
 * заменить (другой SDK, мок в тестах), не трогая промпты и логику шагов.
 */
class OpenAiProvider implements AiProvider {
  constructor(private readonly client: OpenAI, private readonly model: string) {}

  async chat({ messages, maxTokens, json, label }: AiChatOptions): Promise<AiChatResult> {
    const resp: any = await retryOnTransient(
      () => this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens ?? getMaxTokens(),
        messages: messages as any,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      label ? { ...RETRY_DEFAULTS, label } : RETRY_DEFAULTS,
    );

    return {
      text: resp?.choices?.[0]?.message?.content ?? null,
      usage: {
        prompt: resp?.usage?.prompt_tokens,
        completion: resp?.usage?.completion_tokens,
      },
    };
  }
}

/**
 * Провайдер для текущей конфигурации. null — ключ не задан: шаги работают без ИИ
 * (как раньше при пустом getClient), это штатный режим, а не ошибка.
 */
export function createAiProvider(apiConfig?: any): AiProvider | null {
  const client = getClient(apiConfig);
  if (!client) return null;
  return new OpenAiProvider(client, getModel(apiConfig));
}
