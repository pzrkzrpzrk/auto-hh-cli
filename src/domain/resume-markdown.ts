// Рендер резюме hh.ru в Markdown: файл должны читать ИИ-шаги (digest/cover/grade),
// поэтому HTML описаний превращаем в текст, а не сохраняем разметку.
import type { HhResumeData, HhResumeEducationItem, HhResumeSalary } from "../clients/hh-resume.js";
import { sanitizeSegment } from "../paths.js";

const CURRENCY_SIGNS: Record<string, string> = {
  RUR: '₽',
  RUB: '₽',
  USD: '$',
  EUR: '€',
  KZT: '₸',
  BYN: 'Br',
  UAH: '₴',
  GEL: '₾',
  AZN: '₼',
  UZS: 'soʻm',
  KGS: 'сом',
};

// Транслитерация — чтобы имена файлов оставались ASCII и одинаково работали
// в Windows-консоли, git и любых shell-командах.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** HTML описания → обычный текст с сохранением переносов и списков. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  const text = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function formatSalary(salary: HhResumeSalary | null): string | null {
  if (!salary) return null;
  const fmt = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

  let base: string | null = null;
  if (salary.from != null && salary.to != null) base = `${fmt(salary.from)} – ${fmt(salary.to)}`;
  else if (salary.from != null) base = `от ${fmt(salary.from)}`;
  else if (salary.to != null) base = `до ${fmt(salary.to)}`;
  else if (salary.amount != null) base = fmt(salary.amount);
  if (!base) return null;

  const currency = salary.currency
    ? (CURRENCY_SIGNS[salary.currency.toUpperCase()] || salary.currency)
    : '';
  return currency ? `${base} ${currency}` : base;
}

function formatPeriod(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  return `${start || '…'} — ${end || 'по настоящее время'}`;
}

function fullName(data: HhResumeData): string | null {
  const name = [data.lastName, data.firstName, data.middleName].filter(Boolean).join(' ').trim();
  return name || null;
}

function translit(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map(char => TRANSLIT[char] ?? char)
    .join('');
}

/** Имя файла резюме: <ФИО/должность>-<8 символов hash>. Стабильно между запусками. */
export function slugifyResumeName(data: HhResumeData, hash: string): string {
  const base = [data.lastName, data.firstName].filter(Boolean).join('-')
    || data.title
    || 'resume';
  const slug = sanitizeSegment(translit(base))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'resume'}-${String(hash).slice(0, 8).toLowerCase()}`;
}

function renderEducationItem(item: HhResumeEducationItem): string[] {
  const lines: string[] = [];
  const heading = item.institution || item.specialty || item.year;
  if (heading) lines.push(`### ${heading}`, '');
  const details = [item.faculty, item.specialty].filter(Boolean).join(' — ');
  if (details) lines.push(details);
  if (item.year) lines.push(item.year);
  return lines;
}

/** Собирает Markdown-файл резюме. Пустые секции в файл не попадают. */
export function renderResumeMarkdown(data: HhResumeData): string {
  const lines: string[] = [];
  const title = fullName(data) || data.title || 'Резюме';
  lines.push(`# ${title}`);
  lines.push('');

  const facts: [string, string | null][] = [
    ['Желаемая должность', data.title],
    ['Зарплата', formatSalary(data.salary)],
    ['Локация', data.area],
    ['Занятость', data.employment],
    ['График', data.schedule],
    ['Формат работы', data.workFormats.length ? data.workFormats.join(', ') : null],
    ['Готовность к переезду', data.relocation],
    ['Командировки', data.businessTripReadiness],
  ];
  for (const [name, value] of facts) {
    if (value) lines.push(`- **${name}:** ${value}`);
  }
  if (facts.some(([, value]) => value)) lines.push('');

  const about = htmlToText(data.about);
  if (about) {
    lines.push('## О себе', '', about, '');
  }

  if (data.keySkills.length) {
    lines.push('## Ключевые навыки', '');
    for (const skill of data.keySkills) lines.push(`- ${skill}`);
    lines.push('');
  }

  if (data.experience.length) {
    lines.push('## Опыт работы', '');
    for (const job of data.experience) {
      const heading = job.position || job.company || 'Без названия';
      lines.push(`### ${heading}`, '');
      const meta = [job.company, formatPeriod(job.start, job.end)].filter(Boolean).join(' · ');
      if (meta) lines.push(meta);
      const description = htmlToText(job.description);
      if (description) lines.push('', description);
      if (job.industries.length) lines.push('', `Отрасли: ${job.industries.join(', ')}`);
      lines.push('');
    }
  }

  if (data.education.primary.length || data.education.additional.length) {
    lines.push('## Образование', '');
    for (const item of data.education.primary) lines.push(...renderEducationItem(item), '');
    if (data.education.additional.length) {
      lines.push('### Дополнительное образование', '');
      for (const item of data.education.additional) lines.push(...renderEducationItem(item), '');
    }
  }

  if (data.languages.length) {
    lines.push('## Языки', '');
    for (const language of data.languages) {
      lines.push(`- ${language.name}${language.level ? ` — ${language.level}` : ''}`);
    }
    lines.push('');
  }

  if (data.certificates.length) {
    lines.push('## Сертификаты', '');
    for (const certificate of data.certificates) {
      const meta = [certificate.owner, certificate.issued].filter(Boolean).join(', ');
      lines.push(`- ${certificate.title}${meta ? ` (${meta})` : ''}`);
      if (certificate.url) lines.push(`  ${certificate.url}`);
    }
    lines.push('');
  }

  // Сырой текст — только когда структурированных блоков нет: иначе получится дубль.
  const structured = Boolean(about || data.keySkills.length || data.experience.length
    || data.education.primary.length || data.education.additional.length);
  if (!structured && data.rawText) {
    lines.push('## Текст со страницы hh.ru', '', data.rawText, '');
  }

  lines.push('---');
  lines.push(`Источник: ${data.url}`);
  if (data.updatedAt) lines.push(`Обновлено на hh.ru: ${data.updatedAt}`);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

