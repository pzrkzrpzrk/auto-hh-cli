// Composition root: единственное место, где конкретные реализации (MongoDB-хранилища)
// связываются с портами домена. Доменные шаги получают зависимости отсюда, а CLI-модули
// не собирают объект { cacheStore, history } каждый у себя.
//
// Здесь же — точка, где позже подключаются другие адаптеры (ИИ-провайдер, уведомления):
// домен о них не знает, знает только этот файл.
import * as cacheStore from "./infrastructure/mongo/cache-store.js";
import history from "./infrastructure/mongo/history-store.js";
import MongoJudgementCache from "./infrastructure/mongo/judgement-cache.js";
import { createAiProvider } from "./infrastructure/ai/client.js";
import { loadConfig } from "./infrastructure/config/config.js";
import HHClient from "./infrastructure/hh/client.js";
import HHVacancySource from "./infrastructure/hh/vacancy-source.js";
import HHResumeSource from "./infrastructure/hh/resume-source.js";
import HHSourceProvider from "./infrastructure/hh/source-provider.js";
import type { AiProvider, CollectDeps, ResumeSource, SearchDeps, SourceProvider } from "./domain/ports.js";
import type { VacancySource } from "./domain/search/VacancySource.js";
import type { CoverDeps } from "./application/cover.js";
import type { DigestDeps } from "./application/digest.js";

// Зависимости шагов сбора вакансий: search, digest, cover.
export const collectDeps: CollectDeps = { cacheStore, history };

/**
 * Источник вакансий с жизненным циклом: браузер открывается лениво при первом запросе
 * и закрывается после работы. Сценарии про Playwright не знают.
 */
export const vacancySource: SourceProvider<VacancySource> =
  new HHSourceProvider(client => new HHVacancySource(client));

/** Зависимости сценария поиска: хранилища + источник вакансий. */
export const searchDeps: SearchDeps = { ...collectDeps, source: vacancySource };

/** Кэш вердиктов судьи: один адаптер на все сценарии, где судья сохраняет ответы. */
const judgementCache = new MongoJudgementCache();

/** Зависимости сценариев digest и cover: ИИ + хранилища + источник вакансий. */
export const digestDeps: DigestDeps = {
  ai: aiProvider,
  collect: collectDeps,
  source: vacancySource,
  judgements: judgementCache,
};
export const coverDeps: CoverDeps = { ai: aiProvider, collect: collectDeps, source: vacancySource };

/** Открытая сессия резюме: меню держит её между списком и скачиванием и закрывает само. */
export interface ResumeSession extends ResumeSource {
  close(): Promise<void>;
}

export function openResumeSource(): ResumeSession {
  return new HHResumeSource(new HHClient());
}

/** Источник резюме с жизненным циклом: команда скачивания без внешней сессии. */
export const resumeSource: SourceProvider<ResumeSource> =
  new HHSourceProvider(client => new HHResumeSource(client));

/**
 * Провайдер ИИ для текущей конфигурации. null — ключ не задан: шаги работают без ИИ
 * (штатный режим, а не ошибка). Создаётся один раз на команду и передаётся в домен.
 */
export function aiProvider(): AiProvider | null {
  return createAiProvider(loadConfig().api || {});
}
