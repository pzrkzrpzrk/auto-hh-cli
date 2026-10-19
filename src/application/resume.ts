// Сценарий управления резюме: список файлов + регистрация + чтение для показа.
// Печать и коды возврата — в команде: здесь только данные и обращения к портам.
import type { ResumeFiles } from "../domain/ports.js";
import type { ResumeRegistry } from "../domain/digest/ports.js";
import type { Resume } from "../domain/models.js";
import log from "../shared/logger.js";

export interface ResumeDeps {
  /** Файлы резюме на диске. */
  files: ResumeFiles;
  /** Зарегистрированные резюме в MongoDB. */
  registry: ResumeRegistry;
}

export interface ResumeListItem {
  name: string;
  /** id из файла резюме либо '?', если файл не читается. */
  id: string;
  filename: string;
  /** Дата регистрации в MongoDB (YYYY-MM-DD) либо null, если резюме не зарегистрировано. */
  registeredAt: string | null;
}

export type ResumeListOutcome =
  | { kind: 'empty' }
  | { kind: 'ok'; rows: ResumeListItem[] };

export type ResumeRegisterOutcome =
  | { kind: 'missing-name' }
  | { kind: 'not-found'; name: string }
  | { kind: 'ok'; name: string; id: string };

export type ResumeShowOutcome =
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ok'; resume: Resume };

/** Файлы резюме для меню: список без обращения к Mongo. */
export function listResumeFiles(deps: ResumeDeps) {
  return deps.files.list();
}

/** Резюме по имени (или дефолт из env) для меню. */
export function readResumeFile(name: string | undefined, deps: ResumeDeps) {
  return deps.files.load(name);
}

/** Список резюме на диске с пометкой, зарегистрировано ли каждое в MongoDB. */
export async function listResumesForCli(deps: ResumeDeps): Promise<ResumeListOutcome> {
  const files = deps.files.list();
  if (!files.length) return { kind: 'empty' };

  const mongo = await deps.registry.listRegistered();
  const byId = new Map(mongo.map(r => [r.resumeId, r]));

  const rows: ResumeListItem[] = [];
  for (const f of files) {
    const resume = deps.files.load(f.name);
    const registered = resume ? byId.get(resume.id) : null;
    rows.push({
      name: f.name,
      id: resume?.id || '?',
      filename: f.filename,
      registeredAt: registered ? registered.createdAt.toISOString().slice(0, 10) : null,
    });
  }
  return { kind: 'ok', rows };
}

/** Регистрация резюме по имени файла/резюме: проверка имени и запись в MongoDB. */
export async function registerResumeByName(name: string | undefined, deps: ResumeDeps): Promise<ResumeRegisterOutcome> {
  if (!name) return { kind: 'missing-name' };
  const resume = deps.files.load(name);
  if (!resume) return { kind: 'not-found', name };
  await deps.registry.register(resume);
  log.info(`Resume "${name}" registered (id: ${resume.id})`);
  return { kind: 'ok', name, id: resume.id };
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
