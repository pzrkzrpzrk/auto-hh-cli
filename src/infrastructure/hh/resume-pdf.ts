// Скачивание PDF-версии резюме по ссылке «Скачать» на странице.
// URL не угадываем: если ссылки нет (или отдался не PDF), возвращаем null —
// Markdown-версия к этому моменту уже сохранена.
import path from "path";
import fs from "fs";
import log from "@/shared/logger.js";
import { LoginRequiredError } from "@/infrastructure/hh/session.js";
import type HHPageSession from "@/infrastructure/hh/session.js";

async function downloadResumePdf(
  session: HHPageSession,
  hash: string,
  destPath: string,
): Promise<string | null> {
  await session.ensureOpen();
  const page = session.pg;
  if (!page.url().includes(`/resume/${hash}`)) {
    await page.goto(`https://hh.ru/resume/${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  if (/\/account\/login/i.test(page.url())) throw new LoginRequiredError();

  const href = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).map(link => ({
      href: link.getAttribute('href') || '',
      text: ((link as HTMLElement).innerText || link.textContent || '').toLowerCase(),
    }));
    const found = links.find(link => /resume_converter|resume[_-]?download/i.test(link.href))
      || links.find(link => /pdf/i.test(link.href) && /скачать|download/.test(link.text));
    return found ? found.href : null;
  });

  if (!href) {
    log.warn('На странице резюме нет ссылки скачивания PDF — PDF пропущен');
    return null;
  }

  const absolute = new URL(href, page.url()).toString();
  const response = await session.context.request.get(absolute, { timeout: 60000 });
  if (!response.ok()) throw new Error(`PDF: HTTP ${response.status()} ${absolute}`);

  const body = await response.body();
  if (body.subarray(0, 4).toString() !== '%PDF') {
    log.warn(`Ссылка ${absolute} вернула не PDF — файл не сохранён`);
    return null;
  }

  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(destPath, body);
  log.info(`PDF резюме сохранён: ${destPath}`);
  return destPath;
}

export default downloadResumePdf;
