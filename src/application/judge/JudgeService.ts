// Application Service судейства: транспорт ИИ, разбор ответа и диагностика.
//
// Домен (domain/judge) остаётся чистым: Verdict отвечает за инвариант, JudgePrompt — за
// тексты промпта. Здесь только use case: собрать сообщения, вызвать порт, поймать ошибку
// и залогировать теми же строками, что были в прежнем domain/judge/judge.ts.
import { adaptResumeForVacancy } from "@/domain/adapt-resume/index.js";
import { JudgePrompt } from "@/domain/judge/JudgePrompt.js";
import { Verdict } from "@/domain/judge/Verdict.js";
import type { Logger } from "@/domain/logging.js";
import type { Resume, Vacancy } from "@/domain/models.js";
import type { AiMessage, AiProvider } from "@/domain/ports.js";
import { buildResumeBlock } from "@/domain/resume-block.js";
import { errorMessage } from "@/shared/errors.js";
import { parseJSON } from "@/shared/text-utils.js";

/** Настройки прогона судьи: их собирает DigestPolicy, env читает composition root. */
export interface JudgeSettings {
  /** Порог отклика, который печатается в промпте. */
  minScore: number;
  /** Адаптировать резюме под каждую вакансию перед судейством. */
  adaptResume: boolean;
  /** Лимит символов на адаптированное резюме. */
  adaptResumeBudget?: number;
}

export class JudgeService {
  /** ai=null — ключа нет: штатный режим без судьи, методы возвращают null. */
  constructor(
    private readonly ai: AiProvider | null,
    private readonly logger?: Logger,
  ) {}

  /** Одна вакансия: вердикт или null (модель не ответила/ошибка). */
  async judgeOne(resume: Resume, vacancy: Vacancy, settings: JudgeSettings): Promise<Verdict | null> {
    const ai = this.ai;
    if (!ai) return null;

    const prompt = new JudgePrompt(settings.minScore);
    const adaptedText = settings.adaptResume
      ? adaptResumeForVacancy(resume, vacancy, { budgetChars: settings.adaptResumeBudget })
      : null;
    const resumeBlock = buildResumeBlock(resume, adaptedText);
    const messages: AiMessage[] = [
      { role: 'system', content: prompt.system() },
      {
        role: 'user',
        content: [
          ...(resumeBlock ? [resumeBlock] : []),
          { type: 'text', text: prompt.vacancySection(vacancy) },
        ],
      },
    ];

    try {
      const resp = await ai.chat({ messages, json: true, label: `судья ${vacancy.id}` });
      const text = resp.text;
      if (!text) return null;
      // Пустой список — вердикт по умолчанию (как прежний normalizeVerdict({})).
      const verdict = Verdict.listFromModel(parseJSON(text))[0] ?? Verdict.fromModel({});
      this.logger?.debug(`judge ${vacancy.id}: score=${verdict.score} fit=${verdict.fit} in=${resp.usage.prompt} out=${resp.usage.completion}`);
      return verdict;
    } catch (err) {
      this.logger?.warn(`judge failed for ${vacancy.id}: ${errorMessage(err)}`);
      return null;
    }
  }

  /**
   * Пачка вакансий за один запрос: Map vacancyId → вердикт.
   * null — пачка не удалась (вызывающий делает поштучный фолбэк).
   */
  async judgeBatch(resume: Resume, vacancies: Vacancy[], settings: JudgeSettings): Promise<Map<string, Verdict> | null> {
    const ai = this.ai;
    if (!ai) return null;
    if (!vacancies.length) return new Map();

    const prompt = new JudgePrompt(settings.minScore);
    // PDF адаптировать нельзя: иначе при adaptResume=true блок резюме не попадёт в промпт вовсе.
    const textualResume = resume && resume.type === 'text' && resume.text ? resume : null;
    const adapt = Boolean(settings.adaptResume && textualResume);

    const vacanciesText = vacancies.map((vacancy, index) => {
      let block = '';
      if (adapt && textualResume) {
        const adapted = adaptResumeForVacancy(textualResume, vacancy, { budgetChars: settings.adaptResumeBudget });
        if (adapted) {
          block += `${prompt.adaptedResumeBlock(adapted, index + 1)}\n\n`;
        }
      }
      block += prompt.vacancySection(vacancy, index + 1);
      return block;
    }).join('\n\n');

    const resumeBlock = !adapt ? buildResumeBlock(resume) : null;
    const messages: AiMessage[] = [
      { role: 'system', content: prompt.batchSystem(adapt) },
      {
        role: 'user',
        content: [
          ...(resumeBlock ? [resumeBlock] : []),
          { type: 'text', text: vacanciesText },
        ],
      },
    ];

    try {
      const resp = await ai.chat({ messages, json: true, label: `судья батч ${vacancies.length}` });
      const text = resp.text;
      if (!text) return null;

      this.logger?.debug(`judge batch ${vacancies.length}: in=${resp.usage.prompt || 0} out=${resp.usage.completion || 0}`);

      const verdicts = new Map<string, Verdict>();
      for (const verdict of Verdict.listFromModel(parseJSON(text))) {
        verdicts.set(verdict.vacancyId, verdict);
      }
      return verdicts;
    } catch (err) {
      this.logger?.warn(`judge batch failed (${vacancies.length} items): ${errorMessage(err)}`);
      return null;
    }
  }
}
