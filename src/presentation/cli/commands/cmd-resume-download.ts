// Команда resume-download: тонкая оболочка — печать фаз скачивания
// (сценарий — application/resume-download.ts, там же типы опций и результата).
import { resumeDownloadDeps } from "../../../composition.js";
import {
  downloadResumes,
  type ResumeDownloadEvent,
  type ResumeDownloadOptions,
  type ResumeDownloadResult,
} from "../../../application/resume-download.js";

export type { ResumeDownloadOptions, ResumeDownloadResult };

function printEvent(e: ResumeDownloadEvent) {
  switch (e.type) {
    case 'nothing-to-download':
      console.log("Нечего скачивать: резюме не выбраны или не найдены на hh.ru.");
      return;
    case 'error':
      console.error(`✗ ${e.title}: ${e.message}`);
      return;
    case 'file-saved':
      console.log(`✓ ${e.title} → ${e.file}`);
      return;
    case 'file-skipped':
      console.log(`= ${e.title}: файл уже есть, пропускаю (${e.file})`);
      return;
    case 'pdf-saved':
      console.log(`  PDF → ${e.file}`);
      return;
    case 'pdf-skipped':
      console.log(`  PDF уже есть, пропускаю (${e.file})`);
      return;
    case 'summary':
      console.log(`\nГотово: скачано ${e.saved}, пропущено ${e.skipped}, ошибок ${e.failed}. Каталог: ${e.dir}`);
      return;
    default:
      return;
  }
}

export default async function cmdResumeDownload(
  opts: ResumeDownloadOptions = {},
): Promise<ResumeDownloadResult[]> {
  return downloadResumes(opts, resumeDownloadDeps, printEvent);
}
