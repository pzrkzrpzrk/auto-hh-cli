// Клиент к hh.ru через Playwright-скрейпинг.
// API api.hh.ru заблокирован ddos-guard для нашего IP, поэтому ходим на основной
// сайт hh.ru как обычный браузер и забираем JSON из <template id="HH-Lux-InitialState">,
// в котором лежит полное состояние страницы (vacancySearchResult / vacancyView).
// Карточка вакансии лежит в vacancyView.vacancyFull.vacancy: свои имена полей (vacancyId
// вместо id, company вместо employer) и коды вместо текста (employmentForm «FULL»,
// workExperience «moreThan6», workScheduleByDays «FIVE_ON_TWO_OFF»); расшифровка кодов —
// в vacancyFieldsDictionary и vacancyView.translations. Прежние формы ответа
// (vacancyView.vacancy / плоский vacancyView) поддержаны как фолбэки.
// Возвращаемые объекты приведены к формату прежнего API hh.ru, чтобы остальной код не менять.
import path from "path";
import fs from "fs";
import { openBrowser, assertProfileExists } from "@/infrastructure/playwright/browser.js";
import { pageScript } from "@/infrastructure/playwright/page-script.js";
import type { BrowserContext, Page } from "playwright";
import { env } from "@/infrastructure/config/config.js";
import log from "@/shared/logger.js";
import { errorMessage } from "@/shared/errors.js";
import { sleep } from "@/shared/time.js";
import type { Vacancy } from "@/domain/models.js";
import type { SearchParams, SearchPageResult } from "@/domain/search/types.js";
import {
  collectAreaLabels,
  collectEducationLevels,
  collectIndustryLabels,
  findResumeList,
  findResumeObject,
  isEmptyResume,
  mergeResume,
  normalizeResume,
  unwrapResume,
} from "@/infrastructure/hh/resume.js";
import type { HhResumeData, HhResumeSummary } from "@/infrastructure/hh/resume.js";

// Сырой JSON страницы hh.ru: поля меняются вместе с вёрсткой, поэтому здесь
// намеренно свободный тип — валидация и разбор идут ниже.
type RawPageState = Record<string, any>;

interface RawCompensation {
  from?: number | null;
  to?: number | null;
  currencyCode?: string | null;
  gross?: boolean;
  noCompensation?: boolean;
}

function decodeEntities(s: unknown): string {
  if (!s) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function mapCompensation(c: RawCompensation | null | undefined) {
  if (!c) return null;
  if (c.noCompensation) return null;
  if (!c.from && !c.to) return null;
  return {
    from: c.from || null,
    to: c.to || null,
    currency: c.currencyCode || null,
    gross: c.gross,
  };
}

// Краткая запись (как в search response старого API).
function mapSearchItem(v: Record<string, any>) {
  return {
    id: String(v.vacancyId),
    name: v.name,
    employer: v.company ? { name: v.company.visibleName || v.company.name, id: v.company.id } : null,
    area: v.area ? { id: v.area['@id'] ?? v.area.id ?? null, name: v.area.name } : null,
    salary: mapCompensation(v.compensation),
    alternate_url: v.links?.desktop || `https://hh.ru/vacancy/${v.vacancyId}`,
    snippet: v.snippet || null,
    archived: false,
    key_skills: [],
  };
}

// Справочники кодов («FULL», «FIVE_ON_TWO_OFF», «moreThan6») → человекочитаемый текст.
// Лежат в initialState.vacancyFieldsDictionary как [{ id, text }].
function buildFieldsDictionary(dict: Record<string, unknown> | null | undefined): Record<string, Map<string, string>> {
  const out: Record<string, Map<string, string>> = {};
  if (!dict) return out;
  for (const [key, list] of Object.entries(dict)) {
    if (!Array.isArray(list)) continue;
    const map = new Map<string, string>();
    for (const item of list) {
      if (item && item.id != null) map.set(String(item.id), decodeEntities(item.text) || String(item.id));
    }
    if (map.size) out[key] = map;
  }
  return out;
}

// Код из справочника → текст («FULL» → «Полная занятость»); null, если код неизвестен.
function translateCode(
  fields: Record<string, Map<string, string>> | null | undefined,
  key: string,
  code: unknown,
): string | null {
  if (code == null) return null;
  const map = fields?.[key];
  return (map && map.get(String(code))) || null;
}

// Первый код поля: строка | [{ id, text }] → строка.
function firstCode(v: unknown): string | number | null {
  if (Array.isArray(v)) return v.length ? (v[0]?.id ?? v[0]) : null;
  if (v && typeof v === 'object') return (v as { id?: string | number }).id ?? null;
  return (v as string | number) ?? null;
}

// { id, text } | строка → текст.
function objectName(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return null;
  const obj = v as Record<string, any>;
  return obj.text ?? obj.name ?? obj.title ?? obj.id ?? null;
}

// keySkills новой карточки — массив строк (в старом API — [{ name }]).
function toKeySkills(v: unknown): { name: string }[] {
  const raw = v && typeof v === 'object' && 'keySkill' in v ? (v as Record<string, unknown>).keySkill : v;
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((k): string => (typeof k === 'string' ? k : String(k?.name || k?.title || k?.text || '')))
    .filter(Boolean)
    .map(name => ({ name }));
}

// Список кодов (формат работы). Переводить их в текст нельзя: коды («ON_SITE», «REMOTE»,
// «HYBRID») разбирает filter.ts.
function toCodeList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : (v == null ? [] : [v]);
  return list
    .map(x => (typeof x === 'string' ? x : (x?.id ?? x?.code ?? x?.name ?? null)))
    .filter((x): x is string | number => x != null)
    .map(String);
}

// Архивность. В новой карточке status = { archived, disabled, ... } ({archived:false} у живых),
// в старом API — status.active. Неизвестный статус считаем НЕ архивным: иначе смена формы
// ответа помечает архивом всю выдачу (ровно этот дефект и был: archived = !status?.active,
// а поля active в новом payload нет → true для живых вакансий).
function isArchived(v: Record<string, any>): boolean {
  const st = v?.status;
  if (st) {
    if (typeof st.archived === 'boolean') return st.archived;
    if (typeof st.active === 'boolean') return !st.active;
  }
  if (typeof v?.archived === 'boolean') return v.archived;
  return false;
}

// Полная запись (как в getVacancy старого API).
// opts.idHint — id из URL: в новой карточке нет поля id, есть vacancyId;
// opts.links — vacancyView.vacancyFull.links (в нём ссылка desktop);
// opts.translations — vacancyView.translations (в нём расшифровка workExperience);
// opts.fields — справочник кодов из vacancyFieldsDictionary (buildFieldsDictionary).
interface MapVacancyOpts {
  idHint?: string | number | null;
  links?: { desktop?: string } | null;
  translations?: Record<string, any> | null;
  fields?: Record<string, Map<string, string>> | null;
}

// Форма, которую возвращает браузерный скрипт разбора резюме (getMyResumeFromDom).
// Описывает только блоки страницы: личные данные из DOM не читаем, их берём из
// initial state, а тут — то, чего в состоянии может не быть.
interface DomResumeBlocks {
  title: string;
  about: string;
  skills: string[];
  employment: string;
  schedule: string;
  workFormats: string[];
  businessTripReadiness: string;
  birthDate: string;
  citizenship: string[];
  educationLevel: string;
  contacts: { phone: string; email: string; telegram: string };
  experience: Array<{
    company: string;
    position: string;
    start: string;
    end: string;
    description: string;
    industries: string[];
  }>;
  education: Array<{ institution: string; faculty: string; specialty: string; year: string }>;
  languages: Array<{ name: string; level: string | null }>;
  certificates: Array<{ title: string; owner: string | null; issued: string | null; url: string | null }>;
  rawText: string;
}

function mapVacancyView(v: Record<string, any> | null, opts: MapVacancyOpts = {}): Vacancy | null {
  if (!v) return null;
  const rawId = v.vacancyId ?? v.id ?? opts.idHint ?? null;
  const fields = opts.fields || {};
  const employer = v.company || v.employer || null;

  // Опыт: «moreThan6» → «Более 6 лет». В vacancyFieldsDictionary опыта нет, поэтому сначала
  // пробуем справочник, затем translations.workExperience (там текст строкой).
  const experienceText = translateCode(fields, 'workExperience', firstCode(v.workExperience))
    || (typeof opts.translations?.workExperience === 'string' ? opts.translations.workExperience : null)
    || objectName(v.workExperience);

  const employmentCode = firstCode(v.employmentForm);
  const scheduleCodes = toCodeList(v.workScheduleByDays);
  // Формат работы — кодами (см. toCodeList), старое поле workFormat тоже поддержано.
  const workFormatCodes = toCodeList(v.workFormats ?? v.workFormat);

  return {
    id: String(rawId),
    name: decodeEntities(v.name ?? v.title),
    description: decodeEntities(v.description),
    employer: employer ? { name: employer.visibleName || employer.name, id: employer.id } : null,
    area: v.area ? { id: v.area['@id'] ?? v.area.id ?? v.area.regionId ?? null, name: v.area.name } : null,
    salary: mapCompensation(v.compensation ?? v.salary),
    key_skills: toKeySkills(v.keySkills ?? v.key_skills),
    experience: experienceText ? { name: experienceText } : null,
    schedule: scheduleCodes.length
      ? { name: scheduleCodes.map(c => translateCode(fields, 'workScheduleByDays', c) || c).join(', ') }
      : null,
    employment: employmentCode
      ? { name: translateCode(fields, 'employmentForm', employmentCode) || objectName(v.employmentForm) }
      : null,
    work_format: workFormatCodes,
    archived: isArchived(v),
    alternate_url: opts.links?.desktop || v.links?.desktop || `https://hh.ru/vacancy/${rawId}`,
    // Дата публикации на hh.ru (в прежнем API — created_at). Читает шаг digest.
    publishedAt: v.publicationDate
      || v.publicationTimeIso
      || (v.publicationTime && v.publicationTime['$'])
      || null,
  };
}

/** Страница hh.ru увела на форму входа: сессия в профиле истекла. */
class LoginRequiredError extends Error {
  constructor() {
    super('Не залогинен на hh.ru. Войдите через пункт меню «🔑 Войти на hh.ru», затем повторите.');
    this.name = 'LoginRequiredError';
  }
}

class HHClient {
  userAgent: string;
  delay: number;
  ctx: BrowserContext | null;
  page: Page | null;
  headless: boolean;

  constructor() {
    const e = env();
    this.userAgent = e.userAgent;
    this.delay = e.requestDelayMs;
    this.ctx = null;
    this.page = null;
    this.headless = true;
  }

  /** Страница открыта после init(): методы не проверяют null на каждом обращении. */
  private get pg(): Page {
    if (!this.page) throw new Error('Playwright page is not initialized: call init() first');
    return this.page;
  }

  /** Контекст браузера — нужен только для скачивания PDF после init(). */
  private get browserContext(): BrowserContext {
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
    { _retry = false, dump = false }: { _retry?: boolean; dump?: boolean } = {},
  ): Promise<RawPageState> {
    await this.init(this.headless);
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

  async searchVacancies(params: SearchParams): Promise<SearchPageResult> {
    const sp = new URLSearchParams();
    if (params.text) sp.set('text', params.text);
    if (params.area != null) {
      if (Array.isArray(params.area)) {
        for (const id of params.area) sp.append('area', String(id));
      } else {
        sp.set('area', String(params.area));
      }
    }
    if (params.experience) sp.set('experience', params.experience);
    if (params.salary) sp.set('salary', String(params.salary));
    if (params.only_with_salary) sp.set('only_with_salary', 'true');
    if (params.currency) sp.set('currency_code', params.currency);
    if (params.per_page) sp.set('items_on_page', String(params.per_page));
    if (params.page != null) sp.set('page', String(params.page));
    if (params.schedule) sp.set('schedule', params.schedule);
    if (params.employment) sp.set('employment', params.employment);
    // Дата публикации: только вакансии за последние N дней (0/null — без ограничения).
    if (params.search_period != null) sp.set('search_period', String(params.search_period));
    // Порядок выдачи: relevance | publication_time | salary_desc | salary_asc.
    if (params.order_by) sp.set('order_by', params.order_by);

    const url = `https://hh.ru/search/vacancy?${sp.toString()}`;
    const data = await this.fetchInitialState(url);
    const vsr = data.vacancySearchResult;
    if (!vsr) {
      log.warn(`No vacancySearchResult on ${url}`);
      return { items: [], found: 0, pages: 0 };
    }
    const items = (vsr.vacancies || []).map(mapSearchItem);
    const found = vsr.totalResults || items.length;
    const perPage = params.per_page || 50;
    const pages = vsr.paging?.lastPage?.page != null
      ? vsr.paging.lastPage.page + 1
      : Math.ceil(found / perPage);
    return { items, found, pages };
  }

  // Полная карточка. В актуальном ответе hh.ru она лежит в vacancyView.vacancyFull.vacancy
  // (ниже — фолбэки для прежних форм). Без разворачивания обёртки карточка выходила пустой:
  // id «undefined», name undefined и archived true (см. isArchived), из-за чего digest
  // отбрасывал живые вакансии с причиной «archived».
  async getVacancy(id: string | number): Promise<Vacancy | null> {
    const url = `https://hh.ru/vacancy/${id}`;
    const data = await this.fetchInitialState(url);
    const view = data?.vacancyView || null;
    const node = view?.vacancyFull?.vacancy ?? view?.vacancy ?? view;
    if (!node) {
      log.warn(`No vacancy card on ${url}`);
      return null;
    }
    const full = mapVacancyView(node, {
      idHint: id,
      links: view?.vacancyFull?.links || null,
      translations: view?.translations || null,
      fields: buildFieldsDictionary(data.vacancyFieldsDictionary),
    });
    if (!full) return null;
    // Пустую/неразобранную карточку не отдаём: лучше null (шаги залогируют и пропустят),
    // чем мусорный документ с vacancyId «undefined» в cacheFull.
    if (!full.id || full.id === 'undefined' || !full.name) {
      log.warn(`Empty vacancy card ${id} (id=${full.id}, name=${full.name})`);
      return null;
    }
    return full;
  }

  // --- Резюме соискателя ---------------------------------------------------
  // Страница соискательского API закрыта, поэтому список/карточка резюме читаются
  // с сайта: initial state — основной источник, DOM — фолбэк при смене вёрстки.

  /** Список резюме из личного кабинета: https://hh.ru/applicant/resumes. */
  async listMyResumes(): Promise<HhResumeSummary[]> {
    const url = 'https://hh.ru/applicant/resumes';
    let state = null;
    try {
      state = await this.fetchInitialState(url, { dump: true });
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err;
      log.warn(`Не удалось разобрать состояние ${url}: ${errorMessage(err)} — пробую DOM`);
    }

    let items = state ? findResumeList(state) : [];
    if (!items.length) items = await this.listMyResumesFromDom();
    if (!items.length) log.warn(`На ${url} не найдено ни одного резюме`);
    return items;
  }

  /** Фолбэк списка: ссылки на /resume/<hash> на уже открытой странице. */
  async listMyResumesFromDom(): Promise<HhResumeSummary[]> {
    // Страница могла дорисовать список после domcontentloaded — ждём недолго.
    await this.pg.waitForSelector('a[href*="/resume/"]', { timeout: 5000 }).catch(() => {});

    const items = await this.pg.evaluate(() => {
      const out = new Map();
      for (const link of document.querySelectorAll('a[href*="/resume/"]')) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/resume\/([0-9a-f]{16,})/i);
        if (!match) continue;
        const hash = match[1];
        const title = ((link as HTMLElement).innerText || link.textContent || '').replace(/\s+/g, ' ').trim();
        const prev = out.get(hash);
        if (!prev) {
          out.set(hash, { hash, title, status: null, updatedAt: null, url: `https://hh.ru/resume/${hash}` });
        } else if (title.length > (prev.title || '').length) {
          prev.title = title;
        }
      }
      return Array.from(out.values());
    });

    return (items || []).map(item => ({ ...item, title: item.title || item.hash }));
  }

  /** Полное резюме по hash: https://hh.ru/resume/<hash>. */
  async getMyResume(hash: string): Promise<HhResumeData | null> {
    const url = `https://hh.ru/resume/${hash}`;
    let state = null;
    try {
      state = await this.fetchInitialState(url, { dump: true });
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err;
      log.warn(`Не удалось разобрать состояние ${url}: ${errorMessage(err)} — пробую DOM`);
    }

    let data: HhResumeData | null = null;
    if (state) {
      const raw = findResumeObject(state);
      if (raw) {
        // Дата рождения, гражданство и мессенджеры лежат не в объекте резюме, а в
        // applicantProfile.fields — поэтому склеиваем их перед разбором.
        const personal = state?.applicantProfile?.fields;
        const mergedRaw = personal && typeof personal === 'object' && !Array.isArray(personal)
          ? { ...personal, ...raw }
          : raw;
        // Поля схемы hh обёрнуты по одному ({ string }, { date }) — разворачиваем их,
        // а справочники (отрасли, уровни образования, страны) собираем из состояния.
        data = normalizeResume(unwrapResume(mergedRaw), hash, {
          industryLabels: collectIndustryLabels(state),
          educationLevels: collectEducationLevels(state),
          areaLabels: collectAreaLabels(state),
        });
      }
    }

    const fromDom = await this.getMyResumeFromDom(hash).catch(err => {
      log.warn(`DOM-разбор резюме ${hash} не удался: ${errorMessage(err)}`);
      return null;
    });

    const merged = mergeResume(data, fromDom);
    if (!merged || isEmptyResume(merged)) {
      log.warn(`Резюме ${hash} не удалось разобрать: ни initial state, ни DOM не дали данных`);
      return null;
    }
    return merged;
  }

  /**
   * Фолбэк карточки резюме: читаем блоки со страницы.
   * Возвращаем ту же модель, что и normalizeResume, плюс rawText — если ни один
   * блок не распознан, Markdown соберётся из текста страницы.
   */
  async getMyResumeFromDom(hash: string): Promise<HhResumeData | null> {
    // Блоки резюме могут дорисоваться позже; если их нет вовсе — сработает rawText.
    await this.pg.waitForSelector('[data-qa^="resume-block"], [data-qa="resume"], h1', { timeout: 5000 }).catch(() => {});

    // Телефон и почта на своей странице резюме скрыты до «Показать контакты».
    // Клик необязательный: если кнопки нет, просто читаем, что видно.
    await this.pg.click('button:has-text("Показать контакты"), [data-qa*="show-contact"]', { timeout: 1000 })
      .catch(() => {});

    // pageScript, а не голый колбэк: иначе tsx вставляет в него вызовы __name,
    // которых нет в браузере, и evaluate падает (см. playwright/page-script.ts).
    const raw = await this.pg.evaluate<DomResumeBlocks | null>(pageScript<DomResumeBlocks | null>(() => {
      // Страницу капчи/входа нельзя выдавать за резюме — иначе сохранится мусор.
      if (document.querySelector('[data-qa="account-captcha-picture"], form[action*="captcha"]')) return null;

      const text = (el: Element | null): string => (
        el ? ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : ''
      );
      const q = (sel: string, root: ParentNode = document): Element | null => root.querySelector(sel);
      const all = (sel: string, root: ParentNode = document): Element[] => Array.from(root.querySelectorAll(sel));
      const firstText = (root: ParentNode, selectors: string[]): string => {
        for (const sel of selectors) {
          const el = q(sel, root);
          if (el) {
            const value = text(el);
            if (value) return value;
          }
        }
        return '';
      };
      const unique = (list: string[]): string[] => Array.from(new Set(list.filter(Boolean)));

      const title = firstText(document, [
        '[data-qa="resume-block-title-position"]',
        '[data-qa="resume-title"]',
        'h1',
      ]);
      const about = firstText(document, [
        '[data-qa="resume-about-card"]',
        '[data-qa="resume-block-about"]',
        '[data-qa="resume-about"]',
      ]);

      // Навыки: на актуальной странице это карточка skills-card с тегами skill-tag-<id>.
      const skillsRoot = q('[data-qa="skills-card"], [data-qa="resume-block-skills"], [data-qa="resume-skills"]');
      const skills = skillsRoot
        ? unique(
          all('[data-qa^="skill-tag-"], li, .bloko-tag__text', skillsRoot).map(text),
        )
        : [];

      const experience = all('[data-qa="resume-block-experience-item"], .resume-block__experience-item').map(item => ({
        company: firstText(item, [
          '[data-qa="resume-block-experience-company"]',
          '[data-qa="resume-block-experience-employer"]',
        ]),
        position: firstText(item, ['[data-qa="resume-block-experience-position"]']),
        start: firstText(item, [
          '[data-qa="resume-block-experience-date"]',
          '.resume-block__experience-date',
        ]),
        end: '',
        description: firstText(item, [
          '[data-qa="resume-block-experience-description"]',
          '[data-qa="resume-block-experience-additional-info"]',
        ]),
        // Отрасли — отдельными элементами: названия содержат запятые, поэтому
        // общий текст блока на части не режем.
        industries: all('[data-qa="resume-block-experience-industry"]', item).map(text).filter(Boolean),
      }));

      const education = all([
        '[data-qa^="resume-list-card-education-item-"]',
        '[data-qa="resume-block-education-item"]',
        '.resume-block__education-item',
      ].join(', ')).map(item => ({
        institution: firstText(item, [
          '[data-qa="resume-block-education-name"]',
          '[data-qa="resume-block-education-organization"]',
        ]) || text(item),
        faculty: firstText(item, ['[data-qa="resume-block-education-faculty"]', '.resume-block__education-faculty']),
        specialty: firstText(item, ['[data-qa="resume-block-education-specialty"]', '.resume-block__education-specialty']),
        year: firstText(item, ['[data-qa="resume-block-education-year"]'])
          || (text(item).match(/\b(19|20)\d{2}\b/g) || []).slice(-1)[0] || '',
      }));

      const languagesRoot = q('[data-qa="resume-block-languages"], [data-qa="resume-languages"]');
      const languages = languagesRoot
        ? unique(all('li, [data-qa="resume-block-language-item"]', languagesRoot).map(text))
          .map(name => ({ name, level: null }))
        : [];

      const certificatesRoot = q('[data-qa="resume-block-certificates"], [data-qa="resume-certificates"]');
      const certificates = certificatesRoot
        ? unique(all('li, [data-qa="resume-block-certificate-item"]', certificatesRoot).map(text))
          .map(title => ({ title, owner: null, issued: null, url: null }))
        : [];

      // Последний фолбэк: весь видимый текст резюме без навигации и кнопок.
      const root = q('[data-qa="resume"], [data-qa="resume-content"], main') || document.body;
      const pageLines = ((root as HTMLElement).innerText || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

      // Часть фактов у hh без своих data-qa: они печатаются строками «Метка: значение»
      // (иногда метка отдельной строкой, а значение — следующей).
      const labeled = (name: string, requireColon = false): string => {
        const index = pageLines.findIndex(line => line.toLowerCase().startsWith(name.toLowerCase()));
        if (index < 0) return '';
        const rest = pageLines[index].slice(name.length).trim();
        const bare = rest === '';
        if (requireColon && !bare && !rest.startsWith(':')) return '';
        const value = rest.replace(/^:?\s*/, '');
        return value || (pageLines[index + 1] || '');
      };
      const splitList = (value: string): string[] => value
        .split(/,\s*/)
        .map(item => item.trim())
        .filter(Boolean);

      // Часть полей карточки «Желаемая должность» размечена data-qa: значение берём из
      // него (снимая префикс-метку), остальное — по текстовым меткам.
      const fieldValue = (selectors: string[], label: string): string => {
        const value = firstText(document, selectors);
        if (!value) return '';
        return value.toLowerCase().startsWith(label.toLowerCase())
          ? value.slice(label.length).replace(/^\s*:?\s*/, '').trim()
          : value;
      };

      const employment = fieldValue(['[data-qa="resume-position-field-employmentForms"]'], 'Тип занятости')
        || labeled('Тип занятости') || labeled('Занятость');
      const schedule = labeled('График работы') || labeled('График');
      const workFormats = splitList(
        fieldValue(['[data-qa="resume-position-field-workFormats"]'], 'Формат работы') || labeled('Формат работы'),
      );
      const businessTripReadiness = fieldValue(
        ['[data-qa="resume-position-field-businessTripReadiness"]'], 'Командировки',
      ) || labeled('Командировки');
      const birthDate = labeled('Дата рождения', true);
      const citizenship = splitList(labeled('Гражданство', true));
      const educationLevel = labeled('Уровень образования');
      const contacts = {
        phone: firstText(document, [
          '[data-qa="resume-contact-phone-value-text"]',
          '[data-qa="resume-contact-phone-value"]',
        ]) || labeled('Телефон', true),
        email: firstText(document, [
          '[data-qa="resume-contact-email-value-preferred-text"]',
          '[data-qa="resume-contact-email-value"]',
        ]) || labeled('Электронная почта', true) || labeled('Эл. почта', true)
          || labeled('E-mail', true) || labeled('Email', true),
        telegram: labeled('Telegram', true),
      };
      const noise = /^(скачать|редактировать|обновить|поделиться|вернуться|назад|откликнуться|показать контакты|hh\.ru)/i;
      const rawText = pageLines.filter(line => !noise.test(line)).join('\n');

      return {
        title,
        about,
        skills,
        employment,
        schedule,
        workFormats,
        businessTripReadiness,
        birthDate,
        citizenship,
        educationLevel,
        contacts,
        experience,
        education,
        languages,
        certificates,
        rawText,
      };
    }));

    if (!raw) return null;

    return {
      hash,
      firstName: null,
      lastName: null,
      middleName: null,
      title: raw.title || null,
      salary: null,
      area: null,
      employment: raw.employment || null,
      schedule: raw.schedule || null,
      workFormats: raw.workFormats,
      businessTripReadiness: raw.businessTripReadiness || null,
      relocation: null,
      birthDate: raw.birthDate || null,
      citizenship: raw.citizenship,
      contacts: {
        phone: raw.contacts.phone || null,
        email: raw.contacts.email || null,
        telegram: raw.contacts.telegram || null,
      },
      about: raw.about || null,
      keySkills: raw.skills,
      experience: raw.experience,
      education: { primary: raw.education, additional: [] },
      educationLevel: raw.educationLevel || null,
      languages: raw.languages,
      certificates: raw.certificates,
      rawText: raw.rawText || null,
      updatedAt: null,
      url: `https://hh.ru/resume/${hash}`,
    };
  }

  /**
   * Скачивает PDF-версию резюме по ссылке «Скачать» на странице.
   * URL не угадываем: если ссылки нет (или отдался не PDF), возвращаем null —
   * Markdown-версия к этому моменту уже сохранена.
   */
  async downloadResumePdf(hash: string, destPath: string): Promise<string | null> {
    await this.init(this.headless);
    if (!this.pg.url().includes(`/resume/${hash}`)) {
      await this.pg.goto(`https://hh.ru/resume/${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    if (/\/account\/login/i.test(this.pg.url())) throw new LoginRequiredError();

    const href = await this.pg.evaluate(() => {
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

    const absolute = new URL(href, this.pg.url()).toString();
    const response = await this.browserContext.request.get(absolute, { timeout: 60000 });
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
}

export default HHClient;
