// Порты подсистемы дайджеста (DIP/ISP).
// Сценарий сборки, показа и актуализации зависит только от этих интерфейсов;
// SQLite, fs и разбор файлов живут в infrastructure, а связывает их composition root.
import type { CacheStore } from "@/domain/ports.js";
import type { DigestDoc, DigestEntry, Resume, ResumeRef } from "@/domain/models.js";
import type { Judgement } from "@/domain/digest/JudgementSet.js";
import type { RejectedEntry } from "@/domain/digest/DigestCandidate.js";
import type { DigestCacheSnapshot } from "@/domain/digest/types.js";

/** Какие артефакты дайджеста пишутся одинаковым кодом (digest.md и rejected.md). */
export type DigestKind = 'digest' | 'rejected';

/** Запись артефакта: полный DigestEntry либо rejected-запись без письма и комментария. */
export type DigestArtifactEntry = DigestEntry | RejectedEntry;

/**
 * Кэш поиска для дайджеста: страницы/карточки (как у search) плюс загрузка
 * последнего снимка с вердиктами судьи.
 */
export interface DigestCacheStore extends CacheStore {
  loadLatest(resumeId?: string): Promise<DigestCacheSnapshot | null>;
}

/** Хранилище дайджестов и отклонённых вакансий (SQLite + .md-зеркала). */
export interface DigestRepository {
  /**
   * Последний дайджест — вход шагов digest show, cover и apply.
   * resumeId ограничивает выборку одним резюме; без него — самый свежий среди всех.
   */
  latest(resumeId?: string): Promise<DigestDoc | null>;
  /** Дайджест за конкретную дату (сегодняшний) — вход шага apply. */
  byDate(date: string, resumeId?: string): Promise<DigestEntry[]>;
  /** Все дайджесты без отклика (режим apply --type all). */
  all(resumeId?: string): Promise<DigestEntry[]>;
  /** Документы коллекции с датами — вход актуализации. */
  listDocs(kind: DigestKind, resumeId?: string): Promise<DigestDoc[]>;
  /**
   * Записать артефакт и вернуть пути .md-файлов по регионам.
   * resume задаёт папку data/hh-parsing/<name - id>/ и ключ документа в SQLite.
   */
  save(kind: DigestKind, entries: DigestArtifactEntry[], date?: string, resume?: ResumeRef | null): Promise<string[]>;
  /** Сводный снимок актуальных вакансий за дату (actual.md). */
  saveActual(kind: DigestKind, entries: DigestArtifactEntry[], date: string, resume?: ResumeRef | null): string | null;
}

/** Кэш вердиктов ИИ-судьи (коллекция cacheJudgements, ключ date + resumeId + vacancyId). */
export interface JudgementCache {
  save(judgements: Record<string, Judgement>, resumeId?: string, date?: Date): Promise<void>;
  /** Различные resumeId в кэше — для диагностики «сирот» в `resume list`. */
  listResumeIds(): Promise<string[]>;
  /** Сброс вердиктов одного резюме (при изменении содержимого или reset). */
  clearResume(resumeId: string): Promise<number>;
}

/**
 * Письма из кэша, подклеиваемые к записям дайджеста при показе, генерации и отклике.
 * Ключ хранения — resumeId + vacancyId: одно письмо на вакансию для каждого резюме.
 */
export interface CoverLetterCache {
  /**
   * Подклеить письма из кэша.
   * force=true — считать, что писем нет ни в кэше, ни в записи (перегенерировать всё).
   * resumeId — брать только письма этого резюме; без него — последнее письмо по вакансии.
   */
  attach<T extends { id: string | number; coverLetter?: string; coverLetterResumeId?: string | null }>(
    entries: T[],
    opts?: { force?: boolean; resumeId?: string },
  ): Promise<T[]>;
  /** Сохранить письмо (шаг cover): его читают digest show, cover и apply. */
  save(vacancyId: string | number, letter: string, resumeId?: string): Promise<void>;
  /** Различные resumeId в кэше писем — для диагностики «сирот». */
  listResumeIds(): Promise<string[]>;
  /** Сброс писем одного резюме (при изменении содержимого или reset). */
  clearResume(resumeId: string): Promise<number>;
}

/** Зарегистрированное резюме из коллекции resumes — каталог и отпечаток содержимого. */
export interface RegisteredResume {
  resumeId: string;
  name: string;
  filename: string;
  /** sha256 содержимого (текст или base64 PDF); undefined — legacy-документ. */
  contentHash?: string;
  createdAt: Date;
  updatedAt?: Date;
}

/** Итог регистрации: created — документ появился, changed — содержимое изменилось. */
export interface ResumeRegistration {
  created: boolean;
  changed: boolean;
}

/** Регистрация резюме в коллекции resumes (каталог resumeId → имя/файл/отпечаток). */
export interface ResumeRegistry {
  register(resume: Resume): Promise<ResumeRegistration>;
  /** Все зарегистрированные резюме — для списка и join'ов по resumeId. */
  listRegistered(): Promise<RegisteredResume[]>;
  /** Одно резюме по id: нужно `resume show` и проверкам. */
  find(resumeId: string): Promise<RegisteredResume | null>;
}

/** Чтение резюме с диска (порт объявлен в domain/ports.ts: им пользуются grade, cover, digest). */
export type { ResumeProvider } from "@/domain/ports.js";

/** Fallback-источник дайджеста: последние .md-файлы на диске (папка резюме → legacy). */
export interface DigestFileSource {
  latestContents(resume?: ResumeRef | null): string[];
}
