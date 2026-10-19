// Команда скачивания резюме с hh.ru: Markdown для ИИ-шагов + опционально PDF.
// Клиент можно передать снаружи (меню уже открыло список резюме) — тогда команда
// его не закрывает: владелец браузера закрывает его сам.
import fs from "fs";
import path from "path";
import HHClient from "../../../infrastructure/hh/client.js";
import type { HhResumeSummary } from "../../../infrastructure/hh/resume.js";
import { renderResumeMarkdown, slugifyResumeName } from "../../../domain/resume-markdown.js";
import { ensureResumesDir, loadResume, resumesDir } from "../../../infrastructure/files/resume-loader.js";
import { registerResume } from "../../../infrastructure/mongo/resume-store.js";
import log from "../../../shared/logger.js";

export interface ResumeDownloadOptions {
  client?: HHClient;
  /** Список, уже полученный меню: избавляет от повторного открытия страницы. */
  resumes?: HhResumeSummary[];
  /** Hash выбранных резюме; пусто/all — скачать все из списка. */
  hashes?: string[];
  all?: boolean;
  pdf?: boolean;
  overwrite?: boolean;
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

export default async function cmdResumeDownload(
  opts: ResumeDownloadOptions = {},
): Promise<ResumeDownloadResult[]> {
  const dir = ensureResumesDir();
  if (!process.env.RESUMES_DIR && process.env.RESUME_PATH) {
    log.warn('RESUME_PATH задан без RESUMES_DIR: скачанное резюме ляжет рядом с RESUME_PATH и не попадёт в список резюме. Задайте RESUMES_DIR, чтобы использовать его в меню.');
  }
  const client = opts.client ?? new HHClient();
  const ownsClient = !opts.client;

  try {
    await client.init();
    let items = opts.resumes ?? await client.listMyResumes();

    if (opts.hashes?.length && !opts.all) {
      const wanted = new Set(opts.hashes);
      items = items.filter(item => wanted.has(item.hash));
    }
    if (!items.length) {
      console.log("Нечего скачивать: резюме не выбраны или не найдены на hh.ru.");
      return [];
    }

    const results: ResumeDownloadResult[] = [];
    // MongoDB может быть не поднята: пробуем один раз и дальше не тормозим на таймаутах.
    let mongoUnavailable = false;

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
        const data = await client.getMyResume(item.hash);
        if (!data) {
          result.error = "не удалось разобрать страницу резюме";
          console.error(`✗ ${item.title}: ${result.error}`);
          results.push(result);
          continue;
        }

        const name = slugifyResumeName(data, item.hash);
        result.name = name;

        const file = path.join(dir, `${name}.md`);
        result.file = file;
        if (fs.existsSync(file) && !opts.overwrite) {
          result.skipped = true;
          console.log(`= ${item.title}: файл уже есть, пропускаю (${file})`);
        } else {
          fs.writeFileSync(file, renderResumeMarkdown(data), "utf-8");
          console.log(`✓ ${item.title} → ${file}`);
        }

        if (opts.pdf) {
          const pdfFile = path.join(dir, "pdf", `${name}.pdf`);
          try {
            if (fs.existsSync(pdfFile) && !opts.overwrite) {
              result.pdf = pdfFile;
              console.log(`  PDF уже есть, пропускаю (${pdfFile})`);
            } else {
              result.pdf = await client.downloadResumePdf(item.hash, pdfFile);
              if (result.pdf) console.log(`  PDF → ${result.pdf}`);
            }
          } catch (err) {
            // PDF — необязательная копия: .md уже сохранён, поэтому не валим результат.
            if (err?.name === "LoginRequiredError") throw err;
            log.warn(`PDF для «${item.title}» не скачан: ${err?.message || err}`);
          }
        }

        if (!result.skipped && !mongoUnavailable) {
          try {
            const resume = loadResume(name);
            if (resume) await registerResume(resume);
          } catch (err) {
            // MongoDB может быть не поднят — скачанное резюме от этого не страдает.
            mongoUnavailable = true;
            log.warn(`Резюме ${name} скачано, но не зарегистрировано в MongoDB: ${err?.message || err}`);
          }
        }
      } catch (err) {
        // Истёкшую сессию не маскируем под ошибку одного резюме — пусть меню покажет причину.
        if (err?.name === "LoginRequiredError") throw err;
        result.error = err?.message || String(err);
        console.error(`✗ ${item.title}: ${result.error}`);
      }

      results.push(result);
    }

    const saved = results.filter(r => !r.error && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => r.error).length;
    console.log(`\nГотово: скачано ${saved}, пропущено ${skipped}, ошибок ${failed}. Каталог: ${resumesDir()}`);
    return results;
  } finally {
    if (ownsClient) await client.close();
  }
}
