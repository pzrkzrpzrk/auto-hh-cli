// Зависимости сценария писем — только порты (DIP).
// config.json, SQLite, диск и ИИ подставляет composition root, поэтому сценарий
// можно прогнать с подставными портами, без базы и ключа.
import type { AiProvider, CollectDeps, SourceProvider } from "@/domain/ports.js";
import type { CoverLetterCache, DigestRepository, ResumeProvider } from "@/domain/digest/ports.js";
import type { VacancySource } from "@/domain/search/VacancySource.js";

import type { CoverConfig } from "@/domain/cover-letter/config.js";

/** Настройки писем из config.json/env — читает composition root, сценарий их только использует. */
export type { CoverConfig };

/** Зависимости сценария писем — только порты. */
export interface CoverDeps {
  /** Провайдер ИИ создаётся лениво — ровно там, где он нужен (как раньше); путь — из opts.config. */
  ai: (path?: string) => AiProvider | null;
  /** Шаблон письма, адаптация резюме и размер пачки; путь — из opts.config. */
  config: (path?: string) => CoverConfig;
  collect: CollectDeps;
  /** Источник вакансий с жизненным циклом (браузер открывается только при догрузке). */
  source: SourceProvider<VacancySource>;
  /** Чтение резюме с диска (RESUME_PATH / RESUMES_DIR). */
  resumeFiles: ResumeProvider;
  /** Последний дайджест и запись обновлённых писем. */
  digests: DigestRepository;
  /** Письма из cacheCoverLetters: чтение (с force) и запись. */
  letters: CoverLetterCache;
}

/** Итог сценария: команда превращает его в печать (и код возврата для ошибок). */
export type CoverOutcome =
  | { kind: 'no-resume' }
  | { kind: 'not-found'; vacancyId: string }
  | { kind: 'no-letter' }
  | { kind: 'one'; letter: string }
  | { kind: 'digest'; entries: any[]; letters: Map<string, string> }
  | { kind: 'empty' };

/** Карточка вакансии для печати заголовка (вызывается до генерации письма). */
export type OnVacancy = (full: any, vacancyId: string) => void;
