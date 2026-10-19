// Composition root: единственное место, где конкретные реализации (MongoDB-хранилища)
// связываются с портами домена. Доменные шаги получают зависимости отсюда, а CLI-модули
// не собирают объект { cacheStore, history } каждый у себя.
//
// Здесь же — точка, где позже подключаются другие адаптеры (ИИ-провайдер, уведомления):
// домен о них не знает, знает только этот файл.
import * as cacheStore from "./store/cache-store.js";
import history from "./store/history-store.js";
import type { CollectDeps } from "./domain/ports.js";

// Зависимости шагов сбора вакансий: search, digest, cover.
export const collectDeps: CollectDeps = { cacheStore, history };
