// Сценарий управления резюме: список файлов + регистрация + чтение для показа.
// Печать и коды возврата — в команде: здесь только данные и обращения к портам.
import type { ResumeFile, ResumeFiles } from "@/domain/ports.js";
import type {
  CoverLetterCache,
  JudgementCache,
  RegisteredResume,
  ResumeRegistry,
} from "@/domain/digest/ports.js";
import type { Resume } from "@/domain/models.js";
import { resumeContentHash } from "@/shared/hash.js";
import log from "@/shared/logger.js";

export interface ResumeDeps {
  /** Файлы резюме на диске. */
  files: ResumeFiles;
  /** Зарегистрированные резюме в SQLite. */
  registry: ResumeRegistry;
  /** Вердикты: нужны для поиска «сиротских» resumeId (есть в кэше, нет в реестре). */
  judgements: JudgementCache;
  /** Письма: то же — проверка «сирот». */
  letters: CoverLetterCache;
}

export interface ResumeListItem {
  name: string;
  /** id из файла резюме либо '?', если файл не читается. */
  id: string;
  filename: string;
  /** Дата регистрации в SQLite (YYYY-MM-DD) либо null, если резюме не зарегистрировано. */
  registeredAt: string | null;
  /** Дата последнего изменения имени/содержимого в реестре (YYYY-MM-DD). */
  updatedAt: string | null;
  /** Файл изменился после регистрации (хеш содержимого не совпал). */
  contentChanged: boolean;
}

export type ResumeListOutcome =
  | { kind: 'empty' }
  | {
    kind: 'ok';
    rows: ResumeListItem[];
    /** false — база данных недоступна: статусы не получены, но список файлов показан. */
    registryAvailable: boolean;
    /** resumeId, на которые ссылается кэш, но которых нет в реестре. */
    orphanIds: string[];
    /** Зарегистрированные резюме, чьих файлов больше нет. */
    missingIds: string[];
  };

export type ResumeRegisterOutcome =
  | { kind: 'missing-name' }
  | { kind: 'not-found'; name: string }
  | { kind: 'ok'; name: string; id: string; created: boolean; changed: boolean };

export type ResumeShowOutcome =
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ok'; resume: Resume };

/** Информация из реестра для `resume show`: даты и признак изменённого файла. */
export interface ResumeRegistrationInfo {
  createdAt: Date;
  updatedAt?: Date;
  contentChanged: boolean;
}

/** YYYY-MM-DD из даты реестра (Date либо ISO-строка). */
function ymd(value: Date | string | undefined | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Файлы резюме для меню: список без обращения к SQLite. */
export function listResumeFiles(deps: ResumeDeps): ResumeFile[] {
  return deps.files.list();
}

/** Резюме по имени (или дефолт из env) для меню. */
export function readResumeFile(name: string | undefined, deps: ResumeDeps): Resume | null {
  return deps.files.load(name);
}

/**
 * Список резюме на диске с пометкой, зарегистрировано ли каждое в SQLite.
 * База недоступна — это не ошибка: файлы печатаются, статусы помечаются как неизвестные.
 */
export async function listResumesForCli(deps: ResumeDeps): Promise<ResumeListOutcome> {
  const files = deps.files.list();
  if (!files.length) return { kind: 'empty' };

  let registered: RegisteredResume[] = [];
  let registryAvailable = true;
  try {
    registered = await deps.registry.listRegistered();
  } catch (err: any) {
    registryAvailable = false;
    log.warn(`Реестр резюме недоступен: ${err?.message || err}`);
  }

  const byId = new Map(registered.map(r => [r.resumeId, r]));
  const rows: ResumeListItem[] = [];
  const fileIds = new Set<string>();

  for (const f of files) {
    let resume: Resume | null = null;
    try {
      resume = deps.files.load(f.name);
    } catch {
      // Файл не читается — строка останется с id '?'.
    }
    const id = resume?.id || '?';
    if (resume) fileIds.add(resume.id);
    const reg = resume ? byId.get(resume.id) : undefined;
    const hash = resume ? resumeContentHash(resume) : null;
    rows.push({
      name: f.name,
      id,
      filename: f.filename,
      registeredAt: reg ? ymd(reg.createdAt) : null,
      updatedAt: reg ? ymd(reg.updatedAt) : null,
      contentChanged: Boolean(reg?.contentHash && hash && reg.contentHash !== hash),
    });
  }

  // «Сироты»: resumeId, на которые ссылается кэш вердиктов/писем, но которых нет в реестре.
  let orphanIds: string[] = [];
  if (registryAvailable) {
    const [judged, letters] = await Promise.all([
      deps.judgements.listResumeIds().catch(() => [] as string[]),
      deps.letters.listResumeIds().catch(() => [] as string[]),
    ]);
    const known = new Set(registered.map(r => r.resumeId));
    orphanIds = [...new Set([...judged, ...letters])].filter(id => !known.has(id)).sort();
  }
  const missingIds = registered.filter(r => !fileIds.has(r.resumeId)).map(r => r.resumeId).sort();

  return { kind: 'ok', rows, registryAvailable, orphanIds, missingIds };
}

/** Регистрация резюме по имени файла/резюме: проверка имени и запись в SQLite. */
export async function registerResumeByName(name: string | undefined, deps: ResumeDeps): Promise<ResumeRegisterOutcome> {
  if (!name) return { kind: 'missing-name' };
  const resume = deps.files.load(name);
  if (!resume) return { kind: 'not-found', name };
  const { created, changed } = await deps.registry.register(resume);
  log.info(`Resume "${name}" registered (id: ${resume.id}${created ? ', created' : ''}${changed ? ', content changed' : ''})`);
  return { kind: 'ok', name, id: resume.id, created, changed };
}

/** Данные реестра для показа: ошибка базы не должна ломать `resume show`. */
export async function getResumeRegistration(
  resume: Resume,
  deps: ResumeDeps,
): Promise<ResumeRegistrationInfo | null> {
  try {
    const registered = await deps.registry.find(resume.id);
    if (!registered) return null;
    return {
      createdAt: registered.createdAt,
      updatedAt: registered.updatedAt,
      contentChanged: Boolean(
        registered.contentHash && registered.contentHash !== resumeContentHash(resume),
      ),
    };
  } catch {
    return null;
  }
}

/** Резюме для показа: ошибка чтения и «не найдено» различаются, как и раньше. */
export function loadResumeForShow(name: string | undefined, deps: ResumeDeps): ResumeShowOutcome {
  let resume: Resume | null;
  try {
    resume = name ? deps.files.load(name) : deps.files.load();
  } catch (err: any) {
    return { kind: 'error', message: err.message };
  }
  if (!resume) return { kind: 'not-found' };
  return { kind: 'ok', resume };
}
