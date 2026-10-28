// Читатель резюме соискателя. Страница соискательского API закрыта, поэтому список
// и карточка читаются с сайта: initial state — основной источник, DOM — фолбэк при
// смене вёрстки.
import log from "@/shared/logger.js";
import { errorMessage } from "@/shared/errors.js";
import { pageScript } from "@/infrastructure/playwright/page-script.js";
import type { HhResumeData, HhResumeSummary } from "@/domain/models.js";
import { collectResumeBlocks } from "@/infrastructure/hh/resume-dom-blocks.js";
import type { DomResumeBlocks } from "@/infrastructure/hh/resume-dom-blocks.js";
import {
  collectAreaLabels,
  collectEducationLevels,
  collectIndustryLabels,
  findResumeList,
  findResumeObject,
} from "@/infrastructure/hh/resume-lookup.js";
import { isEmptyResume, mergeResume, normalizeResume, unwrapResume } from "@/infrastructure/hh/resume-parser.js";
import { LoginRequiredError } from "@/infrastructure/hh/session.js";
import type HHPageSession from "@/infrastructure/hh/session.js";

class HHResumePageReader {
  constructor(private readonly session: HHPageSession) {}

  /** Список резюме из личного кабинета: https://hh.ru/applicant/resumes. */
  async listMyResumes(): Promise<HhResumeSummary[]> {
    const url = 'https://hh.ru/applicant/resumes';
    let state = null;
    try {
      state = await this.session.fetchInitialState(url, { dump: true });
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
  private async listMyResumesFromDom(): Promise<HhResumeSummary[]> {
    const page = this.session.pg;
    // Страница могла дорисовать список после domcontentloaded — ждём недолго.
    await page.waitForSelector('a[href*="/resume/"]', { timeout: 5000 }).catch(() => {});

    const items = await page.evaluate(() => {
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
      state = await this.session.fetchInitialState(url, { dump: true });
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
  private async getMyResumeFromDom(hash: string): Promise<HhResumeData | null> {
    const page = this.session.pg;
    // Блоки резюме могут дорисоваться позже; если их нет вовсе — сработает rawText.
    await page.waitForSelector('[data-qa^="resume-block"], [data-qa="resume"], h1', { timeout: 5000 }).catch(() => {});

    // Телефон и почта на своей странице резюме скрыты до «Показать контакты».
    // Клик необязательный: если кнопки нет, просто читаем, что видно.
    await page.click('button:has-text("Показать контакты"), [data-qa*="show-contact"]', { timeout: 1000 })
      .catch(() => {});

    // pageScript, а не голый колбэк: иначе tsx вставляет в него вызовы __name,
    // которых нет в браузере, и evaluate падает (см. playwright/page-script.ts).
    const raw = await page.evaluate<DomResumeBlocks | null>(
      pageScript<DomResumeBlocks | null>(collectResumeBlocks),
    );

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
}

export default HHResumePageReader;
