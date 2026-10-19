// Команда apply: отклик через Playwright.
// Работа со страницей — cli/apply/steps.ts, настройки отклика из env — cli/apply/config.ts.
import { openBrowser, PROFILE } from "../../../infrastructure/playwright/browser.js";
import log from "../../../shared/logger.js";
import history from "../../../infrastructure/mongo/history-store.js";
import { getDigestsByDate, getAllDigests } from "../../../infrastructure/mongo/digest-store.js";
import { withCoverLetters } from "../../../infrastructure/mongo/cache-store.js";
import { sleep, rand, dateKey } from "../../../shared/time.js";
import { HEADLESS, MIN_DELAY, MAX_DELAY } from "../../../infrastructure/config/apply-config.js";
import { applyToVacancy, ensureLoggedIn } from "../../../infrastructure/playwright/apply-steps.js";

async function loadDigest(type: string) {
  if (type === 'all') {
    log.info('Loading all digests');
    return getAllDigests('digest');
  }
  return getDigestsByDate('digest', dateKey());
}

async function loginFlow() {
  log.info(`Launching headful browser, profile: ${PROFILE}`);
  log.info('Залогиньтесь на hh.ru вручную, потом просто закройте браузер.');
  const { page } = await openBrowser({ headless: false });
  await page.goto('https://hh.ru/account/login', { waitUntil: 'domcontentloaded' });
  await new Promise(() => {}); // бесконечное ожидание — браузер жив, пока не закроют.
}

async function apply(opts: Record<string, any> = {}) {
  if (opts.login) {
    await loginFlow();
    return;
  }

  const type = opts.type || 'latest';
  const loaded = await loadDigest(type);
  // Актуализированные (шаг `digest actualize`) вакансии пропускаем: их уже нет в поиске.
  const entries = loaded.filter(e => !e.archived);
  if (loaded.length !== entries.length) {
    log.info(`Недоступных пропущено: ${loaded.length - entries.length}`);
  }

  if (opts.limit && Number.isFinite(opts.limit) && opts.limit > 0) {
    entries.splice(opts.limit);
    log.info(`Limit applied: ${opts.limit} vacancies`);
  }
  log.info(`${entries.length} vacancies in digest`);

  // Письма генерируются отдельным шагом (пункт меню «✉️ Письма для дайджеста») и лежат в cacheCoverLetters.
  const planned = await withCoverLetters(entries);
  const withoutLetter = planned.filter(e => !e.coverLetter).length;
  if (withoutLetter) {
    log.warn(`${withoutLetter} вакансий без сопроводительного — пропускаю (сгенерируйте: пункт меню «✉️ Письма для дайджеста»)`);
  }

  const { ctx, page } = await openBrowser({ headless: HEADLESS });

  // Проверка авторизации.
  if (!await ensureLoggedIn(page)) {
    await ctx.close();
    // process.exit() здесь оборвал бы finally в run() и незаписанные данные в Mongo.
    process.exitCode = 1;
    return;
  }

  let ok = 0, fail = 0, skipped = 0;
  for (const entry of planned) {
    if (!entry.coverLetter) {
      log.warn(`Skip ${entry.id}: no cover letter`);
      skipped++;
      continue;
    }
    const state = await history.load();
    const rec = state.applied[entry.id];
    if (rec && !rec.digestOnly) {
      log.info(`Skip ${entry.id}: already applied`);
      continue;
    }
    try {
      const res = await applyToVacancy(page, entry);
      if (res.ok) {
        await history.markApplied(entry.id, { via: 'playwright', url: entry.url });
        ok++;
      } else {
        fail++;
      }
    } catch (err) {
      log.warn(`Apply failed for ${entry.id}: ${err.message}`);
      fail++;
    }
    await sleep(rand(MIN_DELAY, MAX_DELAY));
  }

  log.info(`Done. ok=${ok}, fail=${fail}, skipped=${skipped}`);
  await ctx.close();
}

export default apply;
