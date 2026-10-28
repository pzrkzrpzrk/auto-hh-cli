// Стратегия судейства (Strategy): КАК спрашивать ИИ — пачкой или поштучно.
// Транспорт вынесен в application/judge/JudgeService; в проверках подставляется
// детерминированная стратегия, поэтому DigestJudgeRunner не знает про сеть.
import { JudgeService, type JudgeSettings } from "@/application/judge/index.js";
import type { Logger } from "@/domain/logging.js";
import type { Judgement } from "@/domain/digest/JudgementSet.js";
import type { AiProvider } from "@/domain/ports.js";
import type { Resume, Vacancy } from "@/domain/models.js";

/** Параметры судейства: настройки JudgeService плюс диагностика для адаптера логгера. */
export interface JudgeOptions extends JudgeSettings {
  logger?: Logger;
  [key: string]: unknown;
}

export interface JudgeStrategy {
  /** Пачка целиком: Map vacancyId → вердикт; null — пачка не удалась (нужен fallback). */
  judgeBatch(
    ai: AiProvider | null,
    resume: Resume,
    vacancies: Vacancy[],
    opts: JudgeOptions,
  ): Promise<Map<string, Judgement> | null>;

  /** Одна вакансия: вердикт или null (модель не ответила/ошибка). */
  judgeOne(
    ai: AiProvider | null,
    resume: Resume,
    vacancy: Vacancy,
    opts: JudgeOptions,
  ): Promise<Judgement | null>;
}

/** Боевая стратегия: батч-запрос и поштучный фолбэк через JudgeService. */
export class AiJudgeStrategy implements JudgeStrategy {
  judgeBatch(
    ai: AiProvider | null,
    resume: Resume,
    vacancies: Vacancy[],
    opts: JudgeOptions,
  ): Promise<Map<string, Judgement> | null> {
    return new JudgeService(ai, opts.logger).judgeBatch(resume, vacancies, opts);
  }

  judgeOne(
    ai: AiProvider | null,
    resume: Resume,
    vacancy: Vacancy,
    opts: JudgeOptions,
  ): Promise<Judgement | null> {
    return new JudgeService(ai, opts.logger).judgeOne(resume, vacancy, opts);
  }
}
