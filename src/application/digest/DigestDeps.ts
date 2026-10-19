// Зависимости сценариев дайджеста: только порты домена, без Mongo и fs.
// Раньше этот интерфейс жил рядом со свободными функциями в application/digest.ts;
// теперь он в модуле сценария, а composition root импортирует его отсюда.
import type { AiProvider, CollectDeps, SourceProvider } from "../../domain/ports.js";
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

/** Всё, что нужно сборке дайджеста. */
export interface DigestDeps {
  /** Провайдер ИИ создаётся лениво — ровно там, где он нужен (как раньше). */
  ai: () => AiProvider | null;
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
  cacheStore: DigestCacheStore;
  digest: DigestRepository;
}
