// Сценарий скачивания резюме с hh.ru: Markdown для ИИ-шагов + опционально PDF.
// Печать — в команде: сценарий отдаёт события фаз и итоговый массив результатов.
// Источник резюме можно передать снаружи (меню уже открыло сессию) — тогда сценарий
// её не закрывает: владелец браузера закрывает сам.
import type { HhResumeSummary } from "@/domain/models.js";
import type { ResumeFile, ResumeFiles, ResumeSource, SourceProvider } from "@/domain/ports.js";
import type { ResumeRegistry } from "@/domain/digest/ports.js";
import { renderResumeMarkdown } from "@/domain/resume-markdown.js";
import { resumeFileName } from "@/domain/resume-name.js";
import { errorMessage, errorName } from "@/shared/errors.js";
import log from "@/shared/logger.js";

export interface ResumeDownloadOptions {
  /** Открытая сессия резюме: меню держит её само и само закрывает. */
  source?: ResumeSource;
  /** Список, уже полученный меню: избавляет от повторного открытия страницы. */
  resumes?: HhResumeSummary[];
  /** Hash выбранных резюме; пусто/all — скачать все из списка. */
  hashes?: string[];
  all?: boolean;
  pdf?: boolean;
  overwrite?: boolean;
}

/**
 * Раскладка резюме на диске — факт из конфигурации (env читает composition root).
 * Нужна для предупреждения: при одиночном RESUME_PATH без RESUMES_DIR скачанное
 * резюме не попадёт в список резюме меню.
 */
export interface ResumeDownloadLayout {
  /** Задан RESUMES_DIR: скачанные резюме видны в меню. */
  usesResumesDir: boolean;
  /** Задан RESUME_PATH (одиночное резюме). */
  hasSingleResume: boolean;
}

export interface ResumeDownloadDeps {
  /** Фабрика с жизненным циклом: открыть источник → скачать → закрыть. */
  source: SourceProvider<ResumeSource>;
  /** Файлы резюме на диске: каталог, запись .md, пути PDF. */
  files: ResumeFiles;
  /** Регистрация скачанного резюме в SQLite. */
  registry: ResumeRegistry;
  /** Откуда берутся пути (RESUMES_DIR / RESUME_PATH) — решает composition root. */
  layout: ResumeDownloadLayout;
}

export interface ResumeDownloadResult {
  hash: string;
  title: string;
  name: string | null;
  file: string | null;
  pdf: string | null;
  skipped: boolean;
  error: string | null;
}

/** События для печати: команда выводит их в том же порядке, что и раньше. */
export type ResumeDownloadEvent =
  | { type: 'nothing-to-download' }
  | { type: 'error'; title: string; message: string }
  | { type: 'file-saved'; title: string; file: string }
  | { type: 'file-skipped'; title: string; file: string }
  | { type: 'pdf-saved'; file: string }
  | { type: 'pdf-skipped'; file: string }
  | { type: 'summary'; saved: number; skipped: number; failed: number; dir: string };

/**
 * Имя файла этого же резюме под прежним именем: раньше оно строилось без отчества
 * и должности. Хвост hash общий у старой и новой схемы, поэтому по нему файл
 * находится, и повторное скачивание не плодит дубли с другим resumeId
 * (id выводится из имени файла).
 */
function legacyFileName(files: ResumeFile[], name: string, hash: string): string | null {
  const suffix = `-${String(hash).slice(0, 8).toLowerCase()}`;
  const match = files.find(file => file.name !== name && file.name.toLowerCase().endsWith(suffix));
  return match?.name ?? null;
}

export async function downloadResumes(
  opts: ResumeDownloadOptions = {},
  deps: ResumeDownloadDeps,
  report?: (event: ResumeDownloadEvent) => void,
): Promise<ResumeDownloadResult[]> {
  deps.files.ensureDir();
  if (!deps.layout.usesResumesDir && deps.layout.hasSingleResume) {
    log.warn('RESUME_PATH задан без RESUMES_DIR: скачанное резюме ляжет рядом с RESUME_PATH и не попадёт в список резюме. Задайте RESUMES_DIR, чтобы использовать его в меню.');
  }

  // Переданный источник принадлежит вызывающему (меню): закрывать его не нам.
  if (opts.source) return downloadWith(opts.source, deps, opts, report);
  return deps.source.withSource(source => downloadWith(source, deps, opts, report));
}

async function downloadWith(
  source: ResumeSource,
  deps: ResumeDownloadDeps,
  opts: ResumeDownloadOptions,
  report?: (event: ResumeDownloadEvent) => void,
): Promise<ResumeDownloadResult[]> {
  await source.open();
  let items = opts.resumes ?? await source.listMyResumes();

  if (opts.hashes?.length && !opts.all) {
    const wanted = new Set(opts.hashes);
    items = items.filter(item => wanted.has(item.hash));
  }
  if (!items.length) {
    report?.({ type: 'nothing-to-download' });
    return [];
  }

  const results: ResumeDownloadResult[] = [];
  // База может быть недоступна: пробуем один раз и дальше не тормозим на таймаутах.
  let dbUnavailable = false;

  for (const item of items) {
    const result: ResumeDownloadResult = {
      hash: item.hash,
      title: item.title,
      name: null,
      file: null,
      pdf: null,
      skipped: false,
      error: null,
    };

    try {
      const data = await source.getMyResume(item.hash);
      if (!data) {
        result.error = "не удалось разобрать страницу резюме";
        report?.({ type: 'error', title: item.title, message: result.error });
        results.push(result);
        continue;
      }

      const name = resumeFileName(data, item.hash);
      const legacy = legacyFileName(deps.files.list(), name, item.hash);

      // Файл этого же резюме уже лежит под прежним именем: без подтверждения
      // перезаписи второй файл не создаём.
      if (legacy && !opts.overwrite) {
        result.name = legacy;
        result.file = deps.files.pathFor(legacy, 'md');
        result.skipped = true;
        report?.({ type: 'file-skipped', title: item.title, file: result.file });
        results.push(result);
        continue;
      }
      if (legacy) {
        deps.files.rename(legacy, name);
        log.info(`Резюме «${item.title}»: файл ${legacy} переименован в ${name}`);
      }

      result.name = name;

      const file = deps.files.pathFor(name, 'md');
      result.file = file;
      const saved = deps.files.save(name, renderResumeMarkdown(data), { overwrite: opts.overwrite });
      if (!saved.saved) {
        result.skipped = true;
        report?.({ type: 'file-skipped', title: item.title, file });
      } else {
        report?.({ type: 'file-saved', title: item.title, file });
      }

      if (opts.pdf) {
        const pdfFile = deps.files.pathFor(name, 'pdf');
        try {
          if (deps.files.exists(pdfFile) && !opts.overwrite) {
            result.pdf = pdfFile;
            report?.({ type: 'pdf-skipped', file: pdfFile });
          } else {
            result.pdf = await source.downloadResumePdf(item.hash, pdfFile);
            if (result.pdf) report?.({ type: 'pdf-saved', file: result.pdf });
          }
        } catch (err) {
          // PDF — необязательная копия: .md уже сохранён, поэтому не валим результат.
          if (errorName(err) === "LoginRequiredError") throw err;
          log.warn(`PDF для «${item.title}» не скачан: ${errorMessage(err)}`);
        }
      }

      if (!result.skipped && !dbUnavailable) {
        try {
          const resume = deps.files.load(name);
          if (resume) await deps.registry.register(resume);
        } catch (err) {
          // База может быть недоступна — скачанное резюме от этого не страдает.
          dbUnavailable = true;
          log.warn(`Резюме ${name} скачано, но не зарегистрировано в базе: ${errorMessage(err)}`);
        }
      }
    } catch (err) {
      // Истёкшую сессию не маскируем под ошибку одного резюме — пусть меню покажет причину.
      if (errorName(err) === "LoginRequiredError") throw err;
      result.error = errorMessage(err);
      report?.({ type: 'error', title: item.title, message: result.error });
    }

    results.push(result);
  }

  const saved = results.filter(r => !r.error && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => r.error).length;
  report?.({ type: 'summary', saved, skipped, failed, dir: deps.files.ensureDir() });
  return results;
}
