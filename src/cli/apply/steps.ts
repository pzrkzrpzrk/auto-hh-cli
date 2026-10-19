// Работа со страницей отклика hh.ru: кнопка отклика, сопроводительное, тестовое задание,
// ручное подтверждение. Здесь только Playwright и логи — оркестрация в cli/cmd-apply.ts.
import fs from "fs";
import path from "path";
import log from "../../logger.js";
import { intFromEnv } from "../../env.js";
import { sleep, rand } from "../../time.js";
import { DATA_DIR } from "../../paths.js";
import { MIN_DELAY, MAX_DELAY, TEST_MODE, TEST_TIMEOUT } from "./config.js";

// Селекторы отклика: hh.ru меняет разметку, поэтому их несколько (берём первый подошедший).
const RESPONSE_BUTTON_SELECTORS = [
  'a[data-qa="vacancy-response-link-top"]',
  'a[data-qa="vacancy-response-link"]',
  'button[data-qa="vacancy-response-link-top"]',
  'a[href^="/applicant/vacancy_response"]',
];
const LETTER_TEXTAREA_SEL = 'textarea[data-qa="vacancy-response-popup-form-letter-input"], textarea[name="text"], textarea[data-qa*="letter"]';

// Кнопка отклика: первый подходящий селектор. null — кнопки нет.
async function findResponseButton(page) {
  for (const sel of RESPONSE_BUTTON_SELECTORS) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

// Тестовое задание: skip — пропустить вакансию, manual — ждать ENTER в консоли.
// null — можно продолжать; иначе готовый результат для applyToVacancy.
async function handleTestRequired(entry) {
  log.warn(`Test required for ${entry.id}`);
  if (TEST_MODE === 'skip') return { ok: false, reason: 'test required' };
  if (TEST_MODE === 'manual') {
    try {
      await waitForEnter(`Тест для вакансии "${entry.title || entry.id}" (${entry.url}). Пройдите тест в браузере.`);
    } catch (e) {
      log.warn(`Manual test timeout for ${entry.id}: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }
  return null;
}

// Заполняет сопроводительное. ok=false — поля нет, отправлять без письма нельзя.
// hadTextarea нужен ожиданию подтверждения: попап-форма закрывается вместе с полем.
async function fillLetter(page, entry) {
  const textarea = await page.waitForSelector(LETTER_TEXTAREA_SEL, { timeout: 8000 }).catch(() => null);
  if (textarea && entry.coverLetter) {
    await textarea.fill(entry.coverLetter);
    log.info('Cover letter filled');
    return { ok: true, hadTextarea: true };
  }
  if (entry.coverLetter) {
    const dumpPath = path.join(DATA_DIR, `apply-dom-${entry.id}.html`);
    try {
      const html = await page.content();
      fs.writeFileSync(dumpPath, html);
      log.warn(`Letter textarea NOT found. Dumped DOM to ${dumpPath}`);
    } catch (_) {}
    return { ok: false, hadTextarea: false };
  }
  return { ok: true, hadTextarea: false };
}

// Ждёт, пока пользователь сам нажмёт «Откликнуться» в браузере. false — таймаут.
async function waitForManualSubmit(page, entry, hadTextarea) {
  const manualTimeout = intFromEnv('PW_MANUAL_TIMEOUT_MS', 300000);
  try {
    await page.waitForFunction(
      (args) => {
        const url = window.location.href;
        // Полностраничная форма: редирект на negotiations/test
        if (url.includes('/applicant/negotiations/') || url.includes('/applicant/vacancy_response/test')) {
          return true;
        }
        // Попап-форма: окно с полем ввода закрылось
        if (args.hadTextarea && !document.querySelector(args.textareaSel)) {
          return true;
        }
        // Запасной вариант: кнопка отклика исчезла или стала ссылкой на negotiations
        const btn = document.querySelector('a[data-qa="vacancy-response-link-top"], a[data-qa="vacancy-response-link"]');
        if (btn && btn.getAttribute('href')?.includes('/applicant/negotiations/')) {
          return true;
        }
        return false;
      },
      { textareaSel: LETTER_TEXTAREA_SEL, hadTextarea },
      { timeout: manualTimeout, polling: 500 },
    );
    return true;
  } catch (e) {
    log.warn(`Manual submit wait timeout for ${entry.id}`);
    return false;
  }
}

// Проверка авторизации в сохранённой сессии. false — не залогинен.
async function ensureLoggedIn(page) {
  await page.goto('https://hh.ru/applicant/resumes', { waitUntil: 'domcontentloaded' });
  if (/\/account\/login/.test(page.url())) {
    log.error('Not logged in. Run the menu item «🔑 Войти на hh.ru» first.');
    return false;
  }
  return true;
}

// Один отклик: навигация → проверки → кнопка → тест → письмо → ручное подтверждение.
async function applyToVacancy(page, entry) {
  log.info(`Applying to ${entry.id} (${entry.employer || '?'}: ${entry.title})`);
  await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
  await sleep(rand(MIN_DELAY, MAX_DELAY));

  // Проверяем, не откликались ли уже (по странице, а не по локальной истории).
  const alreadyResponded = await checkAlreadyResponded(page);
  if (alreadyResponded) {
    log.info(`Already applied (detected on page): ${entry.id}`);
    return { ok: true, note: 'already applied (page)' };
  }

  const button = await findResponseButton(page);
  if (!button) {
    log.warn(`No response button found for ${entry.id}`);
    return { ok: false, reason: 'no response button' };
  }
  await button.click().catch(() => {});

  await sleep(rand(1500, 3000));

  // Проверяем тестовое задание.
  const postState = await detectPostState(page);
  if (postState === 'test') {
    const handled = await handleTestRequired(entry);
    if (handled) return handled;
  }
  if (postState === 'applied') {
    log.info(`Already applied (no popup): ${entry.id}`);
    return { ok: true, note: 'already applied' };
  }

  // Новая форма отклика (полностраничная, без попапа): раскрываем поле письма
  const letterToggle = await page.$('[data-qa="vacancy-response-letter-toggle"]');
  if (letterToggle) {
    await letterToggle.click();
    await sleep(rand(500, 1000));
  }

  const letter = await fillLetter(page, entry);
  if (!letter.ok) {
    return { ok: false, reason: 'letter textarea not found — refusing to submit without cover letter' };
  }

  // Ручное подтверждение: пользователь сам нажимает «Откликнуться» в браузере.
  log.info(`\n>>> Вакансия "${entry.title || entry.id}" @ ${entry.employer || '?'}`);
  log.info(`>>> Сопроводительное заполнено. Проверьте и нажмите «Откликнуться» в браузере.`);
  log.info(`>>> Ожидание...`);

  if (!await waitForManualSubmit(page, entry, letter.hadTextarea)) {
    return { ok: false, reason: 'manual submit timeout' };
  }

  if (await detectPostState(page) === 'test') {
    const handled = await handleTestRequired(entry);
    if (handled) return handled;
  }

  log.info(`Submitted: ${entry.id} @ ${entry.employer || '?'}`);
  return { ok: true };
}

// Состояние страницы после отклика: тестовое задание, уже откликнулись или неизвестно.
async function detectPostState(page) {
  const url = page.url();
  if (/\/applicant\/vacancy_response\/test/.test(url)) return 'test';
  if (/\/applicant\/negotiations/.test(url)) return 'applied';
  return 'unknown';
}

// Проверяет, не откликались ли уже на эту вакансию, по содержимому страницы.
async function checkAlreadyResponded(page) {
  // 1. Кнопка отклика — ссылка на negotiations (уже откликнулись)
  const respondedLink = await page.$('a[data-qa="vacancy-response-link-top"][href*="negotiation"], a[data-qa="vacancy-response-link"][href*="negotiation"]');
  if (respondedLink) return true;

  // 2. Текст "Вы откликнулись" на странице
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
  if (/вы\s+откликнулись/i.test(bodyText)) return true;

  // 3. URL уже на negotiations (редирект)
  if (/\/applicant\/negotiations/.test(page.url())) return true;

  return false;
}

// Ожидание ENTER в консоли (ручные тесты и подтверждения).
function waitForEnter(message) {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(`\n>>> ${message}\n>>> Нажмите ENTER в этой консоли, когда закончите...\n`);
    let timer;
    const onData = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      if (timer) clearTimeout(timer);
      resolve();
    };
    process.stdin.resume();
    process.stdin.once('data', onData);
    if (TEST_TIMEOUT > 0) {
      timer = setTimeout(() => {
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        reject(new Error('manual test timeout'));
      }, TEST_TIMEOUT);
    }
  });
}

export { applyToVacancy, ensureLoggedIn };

