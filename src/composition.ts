// Composition root: единственное место, где конкретные реализации (SQLite-хранилища)
// связываются с портами домена. Доменные шаги получают зависимости отсюда, а CLI-модули
// не собирают объект { cacheStore, history } каждый у себя.
//
// Здесь же — точка, где позже подключаются другие адаптеры (ИИ-провайдер, уведомления):
// домен о них не знает, знает только этот файл.
import "@/infrastructure/logging/logger.js";
import * as cacheStore from "@/infrastructure/sqlite/cache-store.js";
import history from "@/infrastructure/sqlite/history-store.js";
import SqliteJudgementCache from "@/infrastructure/sqlite/judgement-cache.js";
import SqliteDigestRepository from "@/infrastructure/sqlite/digest-repository.js";
import SqliteCoverLetterCache from "@/infrastructure/sqlite/cover-letter-cache.js";
import SqliteResumeRegistry from "@/infrastructure/sqlite/resume-registry.js";
import FileDigestSource from "@/infrastructure/files/digest-file-source.js";
import CompositeDataJanitor from "@/infrastructure/janitor.js";
import FileResumeFiles from "@/infrastructure/files/resume-files.js";
import FileSearchReportWriter from "@/infrastructure/files/search-report-writer.js";
import { CwdTextFileWriter } from "@/infrastructure/files/text-file-writer.js";
import { createAiProvider } from "@/infrastructure/ai/client.js";
import { configProvider } from "@/infrastructure/config/config.js";
import { coverConfig } from "@/infrastructure/config/cover-config.js";
import { intFromEnv } from "@/infrastructure/config/env.js";
import { close as closeDb } from "@/infrastructure/sqlite/db.js";
import NodeCronScheduler from "@/infrastructure/scheduling/node-cron.js";
import log from "@/shared/logger.js";
import { MIN_DELAY, MAX_DELAY } from "@/infrastructure/config/apply-config.js";
import PlaywrightApplicationGateway from "@/infrastructure/playwright/application-gateway.js";
import HHClient from "@/infrastructure/hh/client.js";
import HHVacancySource from "@/infrastructure/hh/vacancy-source.js";
import HHResumeSource from "@/infrastructure/hh/resume-source.js";
import HHSourceProvider from "@/infrastructure/hh/source-provider.js";
import type {
  AiProvider,
  CollectDeps,
  ResumeSource,
  SearchDeps,
  SourceProvider,
  TextFileWriter,
} from "@/domain/ports.js";
import type { DigestCacheStore } from "@/domain/digest/ports.js";
import type { VacancySource } from "@/domain/search/VacancySource.js";
import type { ApplyDeps } from "@/application/apply.js";
import type { CoverDeps } from "@/application/cover.js";
import type { DigestDeps } from "@/application/digest.js";
import type { ActualizeDeps, DigestShowDeps } from "@/application/digest.js";
import type { GradeDeps } from "@/application/grade.js";
import type { HistoryDeps } from "@/application/history.js";
import type { ResetDeps } from "@/application/reset.js";
import type { ResumeDeps } from "@/application/resume.js";
import type { ResumeDownloadDeps } from "@/application/resume-download.js";
import type { ScheduleRuntimeDeps } from "@/application/schedule.js";

// Адаптер конфигурации — один на процесс; команды получают его через composition.
export { configProvider };

// Зависимости шагов сбора вакансий: search, digest, cover.
// cacheStore типизирован портом дайджеста (нужен loadLatest), search он тоже удовлетворяет.
export const collectDeps: CollectDeps & { cacheStore: DigestCacheStore } = { cacheStore, history };

/** Сброс данных: файлы data/ и таблицы SQLite (адаптер знает раскладку и список таблиц). */
const dataJanitor = new CompositeDataJanitor();
/** Файлы резюме: один адаптер для resume, resume-download, digest и cover. */
const resumeFiles = new FileResumeFiles();
/** Запись выдачи поиска в data/search/. */
const searchReportWriter = new FileSearchReportWriter();

/**
 * Источник вакансий с жизненным циклом: браузер открывается лениво при первом запросе
 * и закрывается после работы. Сценарии про Playwright не знают.
 */
export const vacancySource: SourceProvider<VacancySource> =
  new HHSourceProvider(client => new HHVacancySource(client));

/** Зависимости сценария поиска: хранилища, конфиг, источник и файловые артефакты. */
export const searchDeps: SearchDeps = {
  ...collectDeps,
  config: configProvider,
  source: vacancySource,
  janitor: dataJanitor,
  reportWriter: searchReportWriter,
  resumeFiles,
};

/** Кэш вердиктов судьи: один адаптер на все сценарии, где судья сохраняет ответы. */
const judgementCache = new SqliteJudgementCache();

// Адаптеры дайджеста: SQLite-репозиторий, письма, регистрация резюме и файловые источники.
const digestRepository = new SqliteDigestRepository();
const coverLetterCache = new SqliteCoverLetterCache();
const resumeRegistry = new SqliteResumeRegistry();
const digestFileSource = new FileDigestSource();

/** Зависимости истории откликов: порт истории + реестр резюме для имён. */
export const historyDeps: HistoryDeps = { history, resumes: resumeRegistry };

/** Зависимости сброса данных: janitor + файлы резюме для точечного сброса. */
export const resetDeps: ResetDeps = { janitor: dataJanitor, resumeFiles };

/** Зависимости сценария резюме: файлы, реестр и кэши для проверки «сирот». */
export const resumeDeps: ResumeDeps = {
  files: resumeFiles,
  registry: resumeRegistry,
  judgements: judgementCache,
  letters: coverLetterCache,
};

/** Зависимости сценария сборки дайджеста. */
export const digestDeps: DigestDeps = {
  config: configProvider,
  settings: {
    judgeBatchSize: intFromEnv('JUDGE_BATCH_SIZE', 10, { min: 1 }),
    aiConcurrency: intFromEnv('AI_CONCURRENCY', 10, { min: 1 }),
  },
  ai: aiProvider,
  aiAvailable: path => aiProvider(path) !== null,
  collect: collectDeps,
  source: vacancySource,
  judgements: judgementCache,
  digest: digestRepository,
  resumes: resumeRegistry,
  resumeFiles,
  digestFiles: digestFileSource,
  coverLetters: coverLetterCache,
};
/** Зависимости показа дайджеста: SQLite-репозиторий, письма, файлы и реестр резюме. */
export const digestShowDeps: DigestShowDeps = {
  digest: digestRepository,
  coverLetters: coverLetterCache,
  files: digestFileSource,
  resumeFiles,
  resumes: resumeRegistry,
};

/** Зависимости актуализации: конфиг, кэш поиска и репозиторий дайджестов. */
export const actualizeDeps: ActualizeDeps = {
  config: configProvider,
  cacheStore,
  digest: digestRepository,
};

/** Зависимости сценария писем: резюме, дайджест, кэш писем и источник вакансий. */
export const coverDeps: CoverDeps = {
  ai: aiProvider,
  config: coverConfig,
  collect: collectDeps,
  source: vacancySource,
  resumeFiles,
  digests: digestRepository,
  letters: coverLetterCache,
};

/**
 * Адаптер отклика: один объект закрывает оба порта — сессию (withSession)
 * и ручной вход (login). Сценарий про Playwright не знает.
 */
const applicationGateway = new PlaywrightApplicationGateway();

/** Зависимости шага отклика: дайджест, письма, история, резюме и сессия браузера. */
export const applyDeps: ApplyDeps = {
  digests: digestRepository,
  letters: coverLetterCache,
  history,
  gateway: applicationGateway,
  login: applicationGateway,
  resumeFiles,
  settings: { minDelayMs: MIN_DELAY, maxDelayMs: MAX_DELAY },
};

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

/** Зависимости скачивания резюме: источник, файлы на диске и регистрация в реестре БД. */
export const resumeDownloadDeps: ResumeDownloadDeps = {
  source: resumeSource,
  files: resumeFiles,
  registry: resumeRegistry,
  // Пути читает composition root: сценарий получает готовый факт, а не env.
  layout: {
    usesResumesDir: Boolean(process.env.RESUMES_DIR),
    hasSingleResume: Boolean(process.env.RESUME_PATH),
  },
};

/** Зависимости оценки резюме: ленивый ИИ и файлы резюме. */
export const gradeDeps: GradeDeps = { ai: aiProvider, resumeFiles, logger: log };

/** Текстовые отчёты CLI (resume-grade.md): файловый I/O за портом, не в presentation. */
export const gradeReportFile: TextFileWriter = new CwdTextFileWriter();

/** Зависимости планировщика: конфиг и адаптер. Шаги передаёт команда. */
export const scheduleDeps: ScheduleRuntimeDeps = {
  config: configProvider,
  scheduler: new NodeCronScheduler(),
};

/**
 * Провайдер ИИ для текущей конфигурации. null — ключ не задан: шаги работают без ИИ
 * (штатный режим, а не ошибка). Создаётся один раз на команду и передаётся в домен.
 */
export function aiProvider(path?: string): AiProvider | null {
  return createAiProvider(configProvider.load(path).api || {});
}

/** Закрыть общие ресурсы процесса (соединение SQLite) — вызывается CLI в finally. */
export async function closeResources(): Promise<void> {
  await closeDb();
}
