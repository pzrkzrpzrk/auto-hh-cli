// Стратегия судейства (Strategy): КАК спрашивать ИИ — пачкой или поштучно.
// Реализация по умолчанию — реальные вызовы доменного судьи; в проверках подставляется
// детерминированная стратегия, поэтому DigestJudgeRunner не знает про сеть.
import { judgeVacancy, judgeVacanciesBatch } from "../../domain/judge/index.js";
import type { Logger } from "../../domain/logging.js";
import type { Judgement } from "../../domain/digest/JudgementSet.js";
import type { AiProvider } from "../../domain/ports.js";
import type { Resume, Vacancy } from "../../domain/models.js";

/** Параметры судейства, общие для пачки и одиночного запроса. */
export interface JudgeOptions {
  minScore: number;
  adaptResume: boolean;
  /** Диагностика домена: передаётся в judge* и пишется адаптером логгера. */
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

/** Боевая стратегия: батч-запрос и поштучный фолбэк через domain/judge. */
export class AiJudgeStrategy implements JudgeStrategy {
  judgeBatch(
    ai: AiProvider | null,
    resume: Resume,
    vacancies: Vacancy[],
    opts: JudgeOptions,
  ): Promise<Map<string, Judgement> | null> {
    return judgeVacanciesBatch(ai, resume, vacancies, opts);
  }

  judgeOne(
    ai: AiProvider | null,
    resume: Resume,
    vacancy: Vacancy,
    opts: JudgeOptions,
  ): Promise<Judgement | null> {
    return judgeVacancy(ai, resume, vacancy, opts);
  }
}
