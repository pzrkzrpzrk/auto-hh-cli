// @ts-nocheck
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
import { chromium } from "playwright";
import { env } from "../config.js";
import log from "../logger.js";
import { sleep } from "../time.js";

const PROFILE = path.resolve(process.env.PW_USER_DATA_DIR || './data/browser-profile');

function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function mapCompensation(c) {
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
function mapSearchItem(v) {
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
function buildFieldsDictionary(dict) {
  const out = {};
  if (!dict) return out;
  for (const [key, list] of Object.entries(dict)) {
    if (!Array.isArray(list)) continue;
    const map = new Map();
    for (const item of list) {
      if (item && item.id != null) map.set(String(item.id), decodeEntities(item.text) || String(item.id));
    }
    if (map.size) out[key] = map;
  }
  return out;
}

// Код из справочника → текст («FULL» → «Полная занятость»); null, если код неизвестен.
function translateCode(fields, key, code) {
  if (code == null) return null;
  const map = fields?.[key];
  return (map && map.get(String(code))) || null;
}

// Первый код поля: строка | [{ id, text }] → строка.
function firstCode(v) {
  if (Array.isArray(v)) return v.length ? (v[0]?.id ?? v[0]) : null;
  return v?.id ?? v ?? null;
}

// { id, text } | строка → текст.
function objectName(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return v.text ?? v.name ?? v.title ?? v.id ?? null;
}

// keySkills новой карточки — массив строк (в старом API — [{ name }]).
function toKeySkills(v) {
  const list = v?.keySkill || v;
  if (!Array.isArray(list)) return [];
  return list
    .map(k => (typeof k === 'string' ? k : (k.name || k.title || k.text || '')))
    .filter(Boolean)
    .map(name => ({ name }));
}

// Список кодов (формат работы). Переводить их в текст нельзя: коды («ON_SITE», «REMOTE»,
// «HYBRID») разбирает filter.ts.
function toCodeList(v) {
  const list = Array.isArray(v) ? v : (v == null ? [] : [v]);
  return list
    .map(x => (typeof x === 'string' ? x : (x?.id ?? x?.code ?? x?.name ?? null)))
    .filter(x => x != null)
    .map(String);
}

// Архивность. В новой карточке status = { archived, disabled, ... } ({archived:false} у живых),
// в старом API — status.active. Неизвестный статус считаем НЕ архивным: иначе смена формы
// ответа помечает архивом всю выдачу (ровно этот дефект и был: archived = !status?.active,
// а поля active в новом payload нет → true для живых вакансий).
function isArchived(v) {
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
function mapVacancyView(v, opts = {}) {
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
    name: decodeEntities(v.name ?? v.title) || null,
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

class HHClient {
  constructor() {
    const e = env();
    this.userAgent = e.userAgent;
    this.delay = e.requestDelayMs;
    this.ctx = null;
    this.page = null;
    this.headless = true;
  }

  async init(headless = true) {
    if (this.ctx && this.headless === headless) return;
    if (this.ctx) await this.close();
    if (!fs.existsSync(PROFILE)) {
      throw new Error(`Browser profile not found: ${PROFILE}. Run the menu item «🔑 Войти на hh.ru» first.`);
    }
    log.info(`Launching Playwright context for hh.ru scraping (headless=${headless})`);
    this.ctx = await chromium.launchPersistentContext(PROFILE, {
      headless,
      viewport: { width: 1280, height: 800 },
    });
    this.headless = headless;
    this.page = this.ctx.pages()[0] || await this.ctx.newPage();
  }

  async close() {
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
      this.page = null;
    }
  }

  async isCaptchaPage() {
    const url = this.page.url();
    if (/captcha/i.test(url)) return true;
    return await this.page.evaluate(() => {
      return !!document.querySelector('[data-qa="account-captcha-picture"], img[src*="captcha"], form[action*="captcha"]');
    }).catch(() => false);
  }

  async solveCaptchaInteractive(url) {
    log.warn('Captcha detected — reopening browser in headful mode. Solve it in the window, then press Enter here.');
    await this.init(false);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await new Promise(resolve => {
      process.stdout.write('Press Enter after solving captcha... ');
      process.stdin.once('data', () => resolve());
    });
    log.info('Resuming in headless mode');
    await this.init(true);
  }

  // Открывает url, парсит JSON из template#HH-Lux-InitialState.
  async fetchInitialState(url, { _retry = false } = {}) {
    await this.init(this.headless);
    await sleep(this.delay);
    const resp = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp || !resp.ok()) {
      const status = resp?.status() || 0;
      throw new Error(`HTTP ${status} ${url}`);
    }
    if (await this.isCaptchaPage()) {
      if (_retry) throw new Error(`Captcha still present after solving on ${url}`);
      await this.solveCaptchaInteractive(url);
      return this.fetchInitialState(url, { _retry: true });
    }
    const json = await this.page.evaluate(() => {
      const tpl = document.querySelector('template#HH-Lux-InitialState');
      return tpl ? tpl.innerHTML : null;
    });
    if (!json) {
      if (!_retry && await this.isCaptchaPage()) {
        await this.solveCaptchaInteractive(url);
        return this.fetchInitialState(url, { _retry: true });
      }
      throw new Error(`No initial state on ${url}`);
    }
    return JSON.parse(json);
  }

  async searchVacancies(params) {
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
  async getVacancy(id) {
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
    // Пустую/неразобранную карточку не отдаём: лучше null (шаги залогируют и пропустят),
    // чем мусорный документ с vacancyId «undefined» в cacheFull.
    if (!full.id || full.id === 'undefined' || !full.name) {
      log.warn(`Empty vacancy card ${id} (id=${full.id}, name=${full.name})`);
      return null;
    }
    return full;
  }
}

export default HHClient;
