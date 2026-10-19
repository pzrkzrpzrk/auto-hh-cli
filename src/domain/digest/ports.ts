// Порты подсистемы дайджеста (DIP/ISP).
// Сценарий сборки, показа и актуализации зависит только от этих интерфейсов;
// MongoDB, fs и разбор файлов живут в infrastructure, а связывает их composition root.
import type { CacheStore } from "../ports.js";
import type { DigestDoc, DigestEntry, Resume } from "../models.js";
import type { DigestCacheSnapshot } from "./types.js";

/** Какие артефакты дайджеста пишутся одинаковым кодом (digest.md и rejected.md). */
export type DigestKind = 'digest' | 'rejected';

/**
 * Кэш поиска для дайджеста: страницы/карточки (как у search) плюс загрузка
 * последнего снимка с вердиктами судьи.
 */
export interface DigestCacheStore extends CacheStore {
  latest(resumeId?: string): Promise<DigestCacheSnapshot | null>;
}

/** Хранилище дайджестов и отклонённых вакансий (MongoDB + .md-зеркала). */
export interface DigestRepository {
  /** Последний дайджест — вход шагов digest show, cover и apply. */
  latest(): Promise<DigestDoc | null>;
  /** Дайджест за конкретную дату (сегодняшний) — вход шага apply. */
  byDate(date: string): Promise<DigestEntry[]>;
  /** Все дайджесты без отклика (режим apply --type all). */
  all(): Promise<DigestEntry[]>;
  /** Документы коллекции с датами — вход актуализации. */
  listDocs(kind: DigestKind): Promise<DigestDoc[]>;
  /** Записать артефакт и вернуть пути .md-файлов по регионам. */
  save(kind: DigestKind, entries: DigestEntry[], date?: string): Promise<string[]>;
  /** Сводный снимок актуальных вакансий за дату (actual.md). */
  saveActual(kind: DigestKind, entries: DigestEntry[], date: string): string | null;
}

/** Кэш вердиктов ИИ-судьи (коллекция cacheJudgements). */
export interface JudgementCache {
  save(judgements: Record<string, any>, resumeId?: string, date?: Date): Promise<void>;
}

/** Письма из кэша, подклеиваемые к записям дайджеста при показе/отклике. */
export interface CoverLetterCache {
  attach<T extends { id: string | number; coverLetter?: string }>(entries: T[]): Promise<T[]>;
}

/** Регистрация резюме в коллекции resumes (без неё не связать вердикты с резюме). */
export interface ResumeRegistry {
  register(resume: Resume): Promise<void>;
}

/** Чтение резюме с диска: файл по имени или путь из .env. */
export interface ResumeProvider {
  load(name?: string): Resume | null;
}

/** Fallback-источник дайджеста: последние .md-файлы на диске. */
export interface DigestFileSource {
  latestContents(): string[];
}
