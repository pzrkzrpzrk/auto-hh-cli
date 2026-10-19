// Composition root: единственное место, где конкретные реализации (MongoDB-хранилища)
// связываются с портами домена. Доменные шаги получают зависимости отсюда, а CLI-модули
// не собирают объект { cacheStore, history } каждый у себя.
//
// Здесь же — точка, где позже подключаются другие адаптеры (ИИ-провайдер, уведомления):
// домен о них не знает, знает только этот файл.
import * as cacheStore from "./infrastructure/mongo/cache-store.js";
import history from "./infrastructure/mongo/history-store.js";
import { createAiProvider } from "./infrastructure/ai/client.js";
import { loadConfig } from "./infrastructure/config/config.js";
import type { AiProvider, CollectDeps } from "./domain/ports.js";

// Зависимости шагов сбора вакансий: search, digest, cover.
export const collectDeps: CollectDeps = { cacheStore, history };

/**
 * Провайдер ИИ для текущей конфигурации. null — ключ не задан: шаги работают без ИИ
 * (штатный режим, а не ошибка). Создаётся один раз на команду и передаётся в домен.
 */
export function aiProvider(): AiProvider | null {
  return createAiProvider(loadConfig().api || {});
}
