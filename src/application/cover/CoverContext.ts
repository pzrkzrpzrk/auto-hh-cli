// Контекст прогона писем по дайджесту: план, который стадии собирают по шагам.
// Один mutable-объект вместо десятка параметров между функциями прежнего coverDigest.
import type { AiProvider } from "../../domain/ports.js";
import type { DigestDoc, DigestEntry, Resume, Vacancy } from "../../domain/models.js";
import type { CoverConfig, CoverDeps } from "./CoverDeps.js";

/** Чем закончился прогон: ok — письма готовы, empty — генерировать нечего. */
export type CoverOutcomeKind = 'ok' | 'empty';

export interface CoverContext {
  readonly deps: CoverDeps;
  readonly opts: Record<string, any>;
  readonly cfg: CoverConfig;
  readonly ai: AiProvider | null;
  readonly resume: Resume;

  /** Стадии заполняют по мере продвижения. */
  digest: DigestDoc | null;
  /** Записи в пределах лимита — их и печатает команда. */
  entries: DigestEntry[];
  /** Записи без письма — кандидаты на генерацию. */
  pending: DigestEntry[];
  /** Описания вакансий из cacheFull (догружаются стадией карточек). */
  fullById: Record<string, Vacancy>;
  /** Вход генератора пачек: вакансия для каждого pending. */
  items: { vacancy: Vacancy }[];
  /** Письма по id: уже готовые + сгенерированные (вход шага apply). */
  letters: Map<string, string>;
  outcome: CoverOutcomeKind;
}
