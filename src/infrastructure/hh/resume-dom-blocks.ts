// Фолбэк-разбор карточки резюме прямо из DOM страницы hh.ru: используется, когда
// initial state не разобрался или сменилась обёртка. Функция выполняется в браузере
// (см. playwright/page-script.ts), поэтому не ссылается на внешние переменные.

// Форма, которую возвращает браузерный скрипт разбора резюме (collectResumeBlocks).
// Описывает только блоки страницы: личные данные из DOM не читаем, их берём из
// initial state, а тут — то, чего в состоянии может не быть.
export interface DomResumeBlocks {
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

export function collectResumeBlocks(): DomResumeBlocks | null {
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
}
