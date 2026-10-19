// Зависимости сценариев дайджеста: только порты домена, без Mongo и fs.
// Раньше этот интерфейс жил рядом со свободными функциями в application/digest.ts;
// теперь он в модуле сценария, а composition root импортирует его отсюда.
import type { AiProvider, CollectDeps, ConfigProvider, SourceProvider } from "../../domain/ports.js";
import type { VacancySource } from "../../domain/search/VacancySource.js";
import type {
  CoverLetterCache,
  DigestCacheStore,
  DigestFileSource,
  DigestRepository,
  JudgementCache,
  ResumeProvider,
  ResumeRegistry,
} from "../../domain/digest/ports.js";

/** Лимиты ИИ-шагов: env читает composition root, сценарий получает числа. */
export interface DigestSettings {
  /** Размер пачки судьи (env JUDGE_BATCH_SIZE). */
  judgeBatchSize: number;
  /** Параллелизм ИИ-запросов (env AI_CONCURRENCY). */
  aiConcurrency: number;
}

/** Всё, что нужно сборке дайджеста. */
export interface DigestDeps {
  /** Конфиг читается по явному пути из opts.config; сценарий не трогает env. */
  config: ConfigProvider;
  /** Лимиты пачек/параллелизма из env. */
  settings: DigestSettings;
  /** Провайдер ИИ создаётся лениво — ровно там, где он нужен (как раньше); путь — из opts.config. */
  ai: (path?: string) => AiProvider | null;
  /** Хранилища сбора: кэш (с загрузкой снимка) и история откликов. */
  collect: CollectDeps & { cacheStore: DigestCacheStore };
  /** Источник вакансий с жизненным циклом (браузер открывается только при догрузке). */
  source: SourceProvider<VacancySource>;
  /** Кэш вердиктов судьи: сервис сохраняет их после каждой пачки. */
  judgements: JudgementCache;
  /** Дайджесты и rejected: показ и запись артефактов. */
  digest: DigestRepository;
  /** Регистрация резюме в Mongo (без неё вердикты не связать с резюме). */
  resumes: ResumeRegistry;
  /** Чтение резюме с диска. */
  resumeFiles: ResumeProvider;
  /** Fallback-источник .md-файлов для показа. */
  digestFiles: DigestFileSource;
  /** Письма из кэша для показа дайджеста. */
  coverLetters: CoverLetterCache;
}

/** Минимальный набор для `digest show`. */
export interface DigestShowDeps {
  digest: DigestRepository;
  coverLetters: CoverLetterCache;
  files: DigestFileSource;
}

/** Минимальный набор для `digest actualize`. */
export interface ActualizeDeps {
  config: ConfigProvider;
  cacheStore: DigestCacheStore;
  digest: DigestRepository;
}
