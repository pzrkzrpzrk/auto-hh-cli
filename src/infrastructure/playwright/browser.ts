// Единый запуск браузера для всего проекта: один PROFILE и одни опции
// launchPersistentContext. Раньше они были скопированы в трёх местах
// (cmd-apply: вход и отклики, infrastructure/hh/client: скрейпинг), и опции могли разойтись.
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";

// Профиль задаётся PW_USER_DATA_DIR; иначе — data/browser-profile в корне проекта.
export const PROFILE = path.resolve(process.env.PW_USER_DATA_DIR || './data/browser-profile');

export interface OpenedBrowser {
  ctx: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

// Создаёт каталог профиля, если его нет: первый запуск не должен падать.
export function ensureProfile(): void {
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
}

// Профиль обязателен (шаг поиска): без сохранённой сессии hh.ru скрейпинг не работает.
// Сообщение оставлено прежним — на него ссылается README и пункт меню «🔑 Войти на hh.ru».
export function assertProfileExists(): void {
  if (!fs.existsSync(PROFILE)) {
    throw new Error(`Browser profile not found: ${PROFILE}. Run the menu item «🔑 Войти на hh.ru» first.`);
  }
}

/**
 * Запускает persistent context с едиными опциями и отдаёт первую страницу.
 * Опции запуска (viewport 1280×800) уже отлажены под hh.ru — менять их нельзя:
 * отпечаток профиля влияет на капчу и разлогин.
 */
export async function openBrowser(opts: { headless?: boolean } = {}): Promise<OpenedBrowser> {
  ensureProfile();
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: opts.headless ?? false,
    viewport: { width: 1280, height: 800 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  return { ctx, page, close: () => ctx.close() };
}
