import type { Logger } from "../logging.js";
import type { Resume, Vacancy } from "../models.js";
import { buildResumeBlock } from "../resume-block.js";
import type { AiProvider } from "../ports.js";
import { stripHtml, parseJSON } from "../../shared/text-utils.js";
import { errorMessage } from "../../shared/errors.js";
import { adaptResumeForVacancy } from "../adapt-resume.js";
import { buildBatchSystemText, coverSignature } from "./system-text.js";
import { chunk, runBatches } from "../../shared/batches.js";

/** Настройки генерации писем: env читает composition root, домен получает значения. */
export interface CoverLetterOptions {
  /** Профиль соискателя (env APPLICANT_PROFILE). */
  profile?: string;
  /** Подпись письма (env COVER_SIGNATURE). */
  signature?: string;
  /** Сколько пачек писем выполняется одновременно (env AI_CONCURRENCY). */
  concurrency?: number;
  logger?: Logger;
}

const DEFAULT_PROFILE = 'опытный разработчик';
const DEFAULT_CONCURRENCY = 10;

function buildFromTemplate(template: string | undefined, vacancy: Vacancy, signature?: string): string {
  const ctx: Record<string, string> = {
    title: vacancy.name || '',
    employer: vacancy.employer?.name || '',
    area: vacancy.area?.name || '',
    signature: coverSignature(signature),
  };
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, k: string) => ctx[k] ?? '');
}

async function buildWithClaude(
  vacancy: Vacancy,
  resume: Resume | null = null,
  adaptResume = false,
  ai: AiProvider | null = null,
  options: CoverLetterOptions = {},
): Promise<string | null> {
  if (!ai) return null;

  const profile = options.profile || DEFAULT_PROFILE;

  const description = stripHtml(vacancy.description).slice(0, 1000);
  const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');

  const adaptedResume = adaptResume && resume ? adaptResumeForVacancy(resume, vacancy) : null;

  const userMsg = `${adaptedResume ? `=== МОЁ РЕЗЮМЕ (релевантное) ===\n${adaptedResume}\n\n` : ''}Вакансия: ${vacancy.name}
Компания: ${vacancy.employer?.name || '—'}
Регион: ${vacancy.area?.name || '—'}
Ключевые навыки: ${skills || '—'}

Описание:
${description}

Напиши короткое сопроводительное письмо от моего имени в официально-деловом стиле. 3–5 предложений.

Образец:
"""
Здравствуйте! Заинтересовала вакансия в вашей компании — профиль полностью совпадает с моим опытом. Последние несколько лет работаю с React и NestJS, уверенно владею SQL/ORM, есть опыт с Next.js и SSR. Буду рад обсудить детали на созвоне.
${coverSignature(options.signature)}
"""

Правила:
- Официально-деловой, нейтрально-вежливый тон. Полные предложения, грамотный русский.
- Никакой разговорности, сленга, сокращений ("прям", "трогал", "подшаманивал" и т.п.).
- Избегай канцеляритных штампов ("рассмотрите мою кандидатуру", "готов внести вклад в развитие"): пиши по делу, но корректно.
- Начни с "Здравствуйте!".
- 1–2 конкретных совпадения из описания вакансии.
- Без markdown, без "С уважением", без имени в подписи.
- Заверши строкой "${coverSignature(options.signature)}".
- Не упоминай зарплату, вилку, ожидания по доходу — ни конкретных цифр, ни общих формулировок ("по рынку", "обсуждаемо" и т.п.).
- Не пиши "Заинтересовала вакансия <название компании>", а пиши "заинтересовала ваша вакансия" или "вакансия в вашей компании".
- Не используй длинные тире.
- Начинай основную часть с указания, что стек и задачи полностью подходят под твой профиль (например: "стек и задачи полностью совпадают с моим опытом", "профиль вакансии полностью соответствует моему стеку").`;

  try {
    const resp = await ai.chat({
      messages: [
        {
          role: 'system',
          content: `Ты помогаешь соискателю писать сопроводительные письма для откликов на hh.ru. Профиль соискателя: ${profile}\n\nПиши лаконично, по-человечески, без канцелярита. Цель — убедить рекрутера открыть резюме.`,
        },
        { role: 'user', content: userMsg },
      ],
      label: 'письмо',
    });
    const text = resp.text?.trim();
    if (text) {
      options.logger?.debug(`Claude usage: in=${resp.usage.prompt} out=${resp.usage.completion}`);
    }
    return text || null;
  } catch (err) {
    options.logger?.warn(`Claude generation failed: ${errorMessage(err)}`);
    return null;
  }
}

// adaptResume приходит параметром (из config.json, см. cmd-cover): домен не читает файлы.
async function buildCoverLetter(
  ai: AiProvider | null,
  template: string | undefined,
  vacancy: Vacancy,
  resume: Resume | null = null,
  adaptResume = true,
  options: CoverLetterOptions = {},
): Promise<string> {
  const claudeText = await buildWithClaude(vacancy, resume, adaptResume, ai, options);
  if (claudeText) return claudeText;
  return buildFromTemplate(template, vacancy, options.signature);
}

function formatVacancyShort(vacancy: Vacancy): string {
  const description = stripHtml(vacancy.description).slice(0, 1000);
  const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');
  return `vacancyId: ${vacancy.id}
Название: ${vacancy.name}
Компания: ${vacancy.employer?.name || '—'}
Регион: ${vacancy.area?.name || '—'}
Ключевые навыки: ${skills || '—'}
Описание:
${description}`;
}

// Генерирует сопроводительные пачками по batchSize вакансий за один запрос.
// items: [{ vacancy }]. Возвращает Map<vacancyId, text>.
// onBatch(partialResult) — вызывается после каждой пачки с накопленным результатом.
// adaptResume приходит параметром (из config.json, см. cmd-cover): домен не читает файлы.
async function buildCoverLettersBatch(
  ai: AiProvider | null,
  resume: Resume | null,
  items: Array<{ vacancy: Vacancy }>,
  batchSize = 20,
  onBatch: ((partial: Map<string, string>) => void | Promise<void>) | null = null,
  adaptResume = true,
  options: CoverLetterOptions = {},
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!ai || !items.length) return result;
  const provider: AiProvider = ai;

  const profile = options.profile || DEFAULT_PROFILE;
  const logger = options.logger;
  const resumeBlock = !adaptResume ? buildResumeBlock(resume) : null;

  const systemText = buildBatchSystemText(profile, options.signature) +
    (adaptResume ? '\n\nДля каждой вакансии передано адаптированное под неё резюме — учитывай его при составлении письма, указывая релевантный опыт.' : '');

  const batchTexts = chunk(items, batchSize).map((batch, i) => ({
    idx: i + 1,
    batch,
    text: batch.map((it, idx) => {
      let block = '';
      if (adaptResume && resume) {
        const adapted = adaptResumeForVacancy(resume, it.vacancy);
        if (adapted) {
          block += `=== РЕЗЮМЕ (релевантное для вакансии #${idx + 1}) ===\n${adapted}\n\n`;
        }
      }
      block += `=== ВАКАНСИЯ #${idx + 1} ===\n${formatVacancyShort(it.vacancy)}`;
      return block;
    }).join('\n\n'),
  }));
  const CONCURRENCY = options.concurrency ?? DEFAULT_CONCURRENCY;

  async function runBatch(ii: number) {
    const { idx, batch, text } = batchTexts[ii];
    const messages = [
      { role: 'system', content: systemText },
      {
        role: 'user',
        content: [
          ...(resumeBlock ? [resumeBlock] : []),
          { type: 'text' as const, text },
        ] as any,
      },
    ] as any;
    try {
      const resp = await provider.chat({ messages, json: true, label: `письма батч ${batch.length}` });

      const content = resp.text;
      if (!content) {
        logger?.warn(`cover batch ${idx}: empty response`);
        return;
      }
      const parsed = parseJSON(content);
      // GLM может вернуть голый массив вместо {"letters": [...]} — принимаем обе формы.
      const list = Array.isArray(parsed) ? parsed : parsed?.letters || [];
      for (const l of list) {
        if (l.vacancyId && l.coverLetter) result.set(String(l.vacancyId), l.coverLetter);
      }
      logger?.debug(`cover batch ${idx}: ${batch.length} letters, in=${resp.usage.prompt || 0} out=${resp.usage.completion || 0}`);
      if (onBatch) {
        try { await onBatch(result); } catch (e) { logger?.warn(`cover onBatch callback failed: ${errorMessage(e)}`); }
      }
    } catch (err) {
      logger?.warn(`cover batch ${idx} failed (${batch.length} items): ${errorMessage(err)}`);
    }
  }

  await runBatches(batchTexts.map(b => b.batch), CONCURRENCY, (_, ii) => runBatch(ii), { logger });

  return result;
}

export { buildCoverLetter, buildCoverLettersBatch };
