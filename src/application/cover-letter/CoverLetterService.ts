// Application Service сопроводительных писем: транспорт ИИ, пачки и fallback на шаблон.
//
// Домен (domain/cover-letter) отвечает за шаблон, подпись и тексты промпта; здесь — use case:
// собрать сообщения, вызвать порт, разложить ответ по пачкам, сохранить частичный прогресс
// через onBatch и залогировать теми же строками, что были в прежнем cover-letter.ts.
import { adaptResumeForVacancy } from "@/domain/adapt-resume.js";
import { CoverLetterPrompt } from "@/domain/cover-letter/CoverLetterPrompt.js";
import { CoverTemplate } from "@/domain/cover-letter/CoverTemplate.js";
import type { CoverSettings } from "@/domain/cover-letter/config.js";
import type { Logger } from "@/domain/logging.js";
import type { Resume, Vacancy } from "@/domain/models.js";
import type { AiMessage, AiProvider } from "@/domain/ports.js";
import { buildResumeBlock } from "@/domain/resume-block.js";
import { chunk, runBatches } from "@/shared/batches.js";
import { errorMessage } from "@/shared/errors.js";
import { parseJSON } from "@/shared/text-utils.js";

/** Частичный результат: вызывается после каждой успешной пачки (накопленная Map). */
export type CoverLettersProgress = (partial: Map<string, string>) => void | Promise<void>;

export class CoverLetterService {
  /** ai=null — ключа нет: одиночное письмо соберётся по шаблону, пачка вернёт пустую Map. */
  constructor(
    private readonly ai: AiProvider | null,
    private readonly settings: CoverSettings,
    private readonly logger?: Logger,
  ) {}

  /** Одно письмо: сначала ИИ, при сбое или пустом ответе — шаблон из настроек. */
  async generateOne(resume: Resume | null, vacancy: Vacancy): Promise<string> {
    const generated = await this.generateWithAi(resume, vacancy);
    if (generated) return generated;
    return new CoverTemplate(this.settings.coverLetterTemplate, this.settings.signature).render(vacancy);
  }

  /**
   * Письма пачками по settings.batchSize: Map vacancyId → текст.
   * Ошибка пачки не валит прогон — письма остальных пачек доходят до результата.
   */
  async generateBatch(
    resume: Resume | null,
    items: Array<{ vacancy: Vacancy }>,
    onBatch?: CoverLettersProgress | null,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const ai = this.ai;
    if (!ai || !items.length) return result;

    const prompt = new CoverLetterPrompt(this.settings.profile, this.settings.signature);
    // PDF адаптировать нельзя — тогда резюме уходит общим блоком (имя файла), как при adaptResume=false.
    const textualResume = resume && resume.type === 'text' && resume.text ? resume : null;
    const adaptationPossible = Boolean(this.settings.adaptResume && textualResume);
    const resumeBlock = adaptationPossible ? null : buildResumeBlock(resume);
    const systemText = prompt.batchSystem(adaptationPossible);

    const batches = chunk(items, this.settings.batchSize).map((batch, index) => ({
      order: index + 1,
      batch,
      text: batch.map((item, position) => {
        let block = '';
        if (adaptationPossible && textualResume) {
          const adapted = adaptResumeForVacancy(textualResume, item.vacancy, {
            budgetChars: this.settings.adaptResumeBudget,
          });
          if (adapted) {
            block += `=== РЕЗЮМЕ (релевантное для вакансии #${position + 1}) ===\n${adapted}\n\n`;
          }
        }
        block += prompt.vacancySection(item.vacancy, position + 1);
        return block;
      }).join('\n\n'),
    }));

    const runBatch = async (index: number) => {
      const { order, batch, text } = batches[index];
      const messages: AiMessage[] = [
        { role: 'system', content: systemText },
        {
          role: 'user',
          content: [
            ...(resumeBlock ? [resumeBlock] : []),
            { type: 'text', text },
          ],
        },
      ];
      try {
        const resp = await ai.chat({ messages, json: true, label: `письма батч ${batch.length}` });

        const content = resp.text;
        if (!content) {
          this.logger?.warn(`cover batch ${order}: empty response`);
          return;
        }
        const parsed = parseJSON(content);
        // GLM может вернуть голый массив вместо {"letters": [...]} — принимаем обе формы.
        const list = Array.isArray(parsed) ? parsed : parsed?.letters || [];
        for (const letter of list) {
          if (letter.vacancyId && letter.coverLetter) result.set(String(letter.vacancyId), letter.coverLetter);
        }
        this.logger?.debug(`cover batch ${order}: ${batch.length} letters, in=${resp.usage.prompt || 0} out=${resp.usage.completion || 0}`);
        if (onBatch) {
          try {
            await onBatch(result);
          } catch (err) {
            this.logger?.warn(`cover onBatch callback failed: ${errorMessage(err)}`);
          }
        }
      } catch (err) {
        this.logger?.warn(`cover batch ${order} failed (${batch.length} items): ${errorMessage(err)}`);
      }
    };

    await runBatches(batches.map(batch => batch.batch), this.settings.concurrency, (_, index) => runBatch(index), {
      logger: this.logger,
    });
    return result;
  }

  /** Одиночный запрос к модели: null — ключа нет, пустой ответ или ошибка. */
  private async generateWithAi(resume: Resume | null, vacancy: Vacancy): Promise<string | null> {
    const ai = this.ai;
    if (!ai) return null;

    const prompt = new CoverLetterPrompt(this.settings.profile, this.settings.signature);
    const adaptedResume = this.settings.adaptResume
      ? adaptResumeForVacancy(resume, vacancy, { budgetChars: this.settings.adaptResumeBudget })
      : null;
    // buildResumeBlock сам решает, что показать: адаптированный текст, PDF или полное резюме.
    const resumeBlock = this.settings.adaptResume ? buildResumeBlock(resume, adaptedResume) : null;
    const messages: AiMessage[] = [
      { role: 'system', content: prompt.system() },
      { role: 'user', content: prompt.singleUser(vacancy, resumeBlock ? resumeBlock.text : null) },
    ];

    try {
      const resp = await ai.chat({ messages, label: 'письмо' });
      const text = resp.text?.trim();
      if (text) {
        this.logger?.debug(`Claude usage: in=${resp.usage.prompt} out=${resp.usage.completion}`);
      }
      return text || null;
    } catch (err) {
      this.logger?.warn(`Claude generation failed: ${errorMessage(err)}`);
      return null;
    }
  }
}
