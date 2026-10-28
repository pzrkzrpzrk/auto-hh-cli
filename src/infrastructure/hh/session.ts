// Сессия Playwright для скрейпинга hh.ru: запуск и закрытие браузера, капча,
// чтение JSON из <template id="HH-Lux-InitialState">.
// Читатели страниц получают её через узкий порт PageFetcher и не знают про профиль,
// таймауты и headless-режим.
import path from "path";
import fs from "fs";
import { openBrowser, assertProfileExists } from "@/infrastructure/playwright/browser.js";
import type { BrowserContext, Page } from "playwright";
import { env } from "@/infrastructure/config/config.js";
import log from "@/shared/logger.js";
import { errorMessage } from "@/shared/errors.js";
import { sleep } from "@/shared/time.js";

// Сырой JSON страницы hh.ru: поля меняются вместе с вёрсткой, поэтому здесь
// намеренно свободный тип — валидация и разбор идут в маппинге.
export type RawPageState = Record<string, any>;

/** Опции загрузки страницы: повтор после капчи и dump состояния для отладки. */
export interface FetchOptions {
  _retry?: boolean;
  dump?: boolean;
}

/** Минимальный порт сессии для читателей страниц: им нужен только initial state. */
export interface PageFetcher {
  fetchInitialState(url: string, opts?: FetchOptions): Promise<RawPageState>;
}

/** Страница hh.ru увела на форму входа: сессия в профиле истекла. */
export class LoginRequiredError extends Error {
  constructor() {
    super('Не залогинен на hh.ru. Войдите через пункт меню «🔑 Войти на hh.ru», затем повторите.');
    this.name = 'LoginRequiredError';
  }
}

class HHPageSession implements PageFetcher {
  readonly userAgent: string;
  readonly delay: number;
  private ctx: BrowserContext | null;
  private page: Page | null;
  private headless: boolean;

  constructor() {
    const e = env();
    this.userAgent = e.userAgent;
    this.delay = e.requestDelayMs;
    this.ctx = null;
    this.page = null;
    this.headless = true;
  }

  /** Страница открыта после init(): методы не проверяют null на каждом обращении. */
  get pg(): Page {
    if (!this.page) throw new Error('Playwright page is not initialized: call init() first');
    return this.page;
  }

  /** Контекст браузера — нужен только для скачивания PDF после init(). */
  get context(): BrowserContext {
    if (!this.ctx) throw new Error('Playwright context is not initialized: call init() first');
    return this.ctx;
  }

  async init(headless = true) {
    if (this.ctx && this.headless === headless) return;
    if (this.ctx) await this.close();
    // Профиль обязателен: без сохранённой сессии hh.ru скрейпинг не работает.
    assertProfileExists();
    log.info(`Launching Playwright context for hh.ru scraping (headless=${headless})`);
    const { ctx, page } = await openBrowser({ headless });
    this.ctx = ctx;
    this.page = page;
    this.headless = headless;
  }

  async close() {
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
      this.page = null;
    }
  }

  /** Открыть браузер в уже выбранном режиме (headless/headful). */
  async ensureOpen() {
    await this.init(this.headless);
  }

  async isCaptchaPage() {
    const url = this.pg.url();
    if (/captcha/i.test(url)) return true;
    return await this.pg.evaluate(() => {
      return !!document.querySelector('[data-qa="account-captcha-picture"], img[src*="captcha"], form[action*="captcha"]');
    }).catch(() => false);
  }

  async solveCaptchaInteractive(url: string) {
    log.warn('Captcha detected — reopening browser in headful mode. Solve it in the window, then press Enter here.');
    await this.init(false);
    await this.pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await new Promise<void>(resolve => {
      process.stdout.write('Press Enter after solving captcha... ');
      process.stdin.once('data', () => resolve());
    });
    log.info('Resuming in headless mode');
    await this.init(true);
  }

  // Читает JSON из template#HH-Lux-InitialState на уже открытой странице.
  async readInitialState(): Promise<RawPageState | null> {
    const json = await this.pg.evaluate(() => {
      const tpl = document.querySelector('template#HH-Lux-InitialState');
      return tpl ? tpl.innerHTML : null;
    });
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch (err) {
      log.warn(`Не удалось разобрать initial state: ${errorMessage(err)}`);
      return null;
    }
  }

  // Сохраняет сырое состояние страницы для отладки разметки (HH_DUMP_STATE=1).
  dumpState(state: unknown, url: string) {
    try {
      const dir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const hash = (String(url).match(/\/resume\/([0-9a-f]{16,})/i) || [])[1] || 'page';
      const file = path.join(dir, `tmp-resume-state-${hash.slice(0, 16)}.json`);
      fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
      log.info(`Initial state сохранён для отладки: ${file}`);
    } catch (err) {
      log.warn(`Не удалось сохранить initial state: ${errorMessage(err)}`);
    }
  }

  // Открывает url, парсит JSON из template#HH-Lux-InitialState.
  async fetchInitialState(
    url: string,
    { _retry = false, dump = false }: FetchOptions = {},
  ): Promise<RawPageState> {
    await this.ensureOpen();
    await sleep(this.delay);
    const resp = await this.pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Редирект на логин — это не «сломанная вёрстка», а истёкшая сессия профиля.
    if (/\/account\/login/i.test(this.pg.url())) throw new LoginRequiredError();
    if (!resp || !resp.ok()) {
      const status = resp?.status() || 0;
      throw new Error(`HTTP ${status} ${url}`);
    }
    if (await this.isCaptchaPage()) {
      if (_retry) throw new Error(`Captcha still present after solving on ${url}`);
      await this.solveCaptchaInteractive(url);
      return this.fetchInitialState(url, { _retry: true, dump });
    }
    const data = await this.readInitialState();
    if (!data) {
      if (!_retry && await this.isCaptchaPage()) {
        await this.solveCaptchaInteractive(url);
        return this.fetchInitialState(url, { _retry: true, dump });
      }
      throw new Error(`No initial state on ${url}`);
    }
    if (dump && process.env.HH_DUMP_STATE) this.dumpState(data, url);
    return data;
  }
}

export default HHPageSession;
