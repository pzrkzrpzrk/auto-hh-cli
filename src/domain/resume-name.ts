// Имя файла скачанного резюме: ФИО + должность + короткий hash.
// Живёт в домене, потому что это правило именования, а не рендер Markdown: fs здесь нет.
import type { HhResumeData } from "@/domain/models.js";
import { sanitizeSegment } from "@/shared/path-utils.js";

// Транслитерация — чтобы имена файлов оставались ASCII и одинаково работали
// в Windows-консоли, git и любых shell-командах.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

// Длина части «ФИО-должность»: длинный заголовок вакансии вместе с каталогом
// data/hh-parsing/<имя резюме> - <resumeId>/ ломает MAX_PATH на Windows.
const NAME_LIMIT = 80;

// Сколько символов hash остаётся в имени: хватает для уникальности и удобно читать.
const HASH_LIMIT = 8;

function translit(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map(char => TRANSLIT[char] ?? char)
    .join('');
}

/** Непустая часть имени: пробелы по краям не должны превращаться в дефисы. */
function part(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

/**
 * Имя файла резюме: `<фамилия-имя-отчество-должность>-<8 символов hash>`.
 * Хвост hash делает имя уникальным и позволяет найти раньше скачанный файл,
 * даже если схема имени менялась. Отсутствующие части пропускаются: без ФИО
 * остаётся должность, без должности — ФИО, без того и другого — `resume`.
 */
export function resumeFileName(data: HhResumeData, hash: string): string {
  const person = [part(data.lastName), part(data.firstName), part(data.middleName)]
    .filter(Boolean)
    .join('-');
  const base = [person, part(data.title)].filter(Boolean).join('-') || 'resume';
  const slug = sanitizeSegment(translit(base))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, NAME_LIMIT)
    .replace(/-+$/, '');
  return `${slug || 'resume'}-${String(hash).slice(0, HASH_LIMIT).toLowerCase()}`;
}
