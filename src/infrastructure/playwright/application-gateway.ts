// Адаптер портов отклика: жизненный цикл браузера и шаги страницы hh.ru.
// Сценарий application/apply.ts видит только «войди» и «откликнись» — Playwright и
// селекторы остаются деталью этого файла.
import type { Page } from "playwright";
import { openBrowser, PROFILE } from "./browser.js";
import { applyToVacancy, ensureLoggedIn } from "./apply-steps.js";
import { HEADLESS } from "../config/apply-config.js";
import log from "../../shared/logger.js";
import type {
  ApplicationGateway,
  ApplicationSession,
  ApplyResult,
  LoginGateway,
} from "../../domain/ports.js";
import type { DigestEntry } from "../../domain/models.js";

/** Открытая сессия: страница уже есть, сценарию нужны только два действия. */
class PlaywrightApplicationSession implements ApplicationSession {
  constructor(private readonly page: Page) {}

  ensureLoggedIn(): Promise<boolean> {
    return ensureLoggedIn(this.page);
  }

  apply(entry: DigestEntry): Promise<ApplyResult> {
    return applyToVacancy(this.page, entry);
  }
}

/**
 * Один адаптер на оба порта: сессия отклика (withSession) и ручной вход (login).
 * Браузер открывается лениво — только на время прогона и закрывается в finally.
 */
class PlaywrightApplicationGateway implements ApplicationGateway, LoginGateway {
  async withSession<R>(fn: (session: ApplicationSession) => Promise<R>): Promise<R> {
    const { ctx, page } = await openBrowser({ headless: HEADLESS });
    try {
      return await fn(new PlaywrightApplicationSession(page));
    } finally {
      await ctx.close();
    }
  }

  /** Ручной вход: headful-браузер держится, пока пользователь его не закроет. */
  async login(): Promise<void> {
    log.info(`Launching headful browser, profile: ${PROFILE}`);
    log.info('Залогиньтесь на hh.ru вручную, потом просто закройте браузер.');
    const { page } = await openBrowser({ headless: false });
    await page.goto('https://hh.ru/account/login', { waitUntil: 'domcontentloaded' });
    await new Promise(() => {}); // бесконечное ожидание — браузер жив, пока не закроют.
  }
}

export default PlaywrightApplicationGateway;