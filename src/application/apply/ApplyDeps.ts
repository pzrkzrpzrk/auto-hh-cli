// Зависимости сценария отклика — только порты (DIP).
// Playwright и MongoDB подставляет composition root, поэтому сценарий можно прогнать
// с подставной сессией и хранилищами.
import type { ApplicationGateway, HistoryStore, LoginGateway, ResumeProvider } from "@/domain/ports.js";
import type { CoverLetterCache, DigestRepository } from "@/domain/digest/ports.js";

/** Итог сценария: команда выставляет exitCode только при неудачной авторизации/резюме. */
export type ApplyOutcome =
  | { kind: 'login' }
  | { kind: 'not-logged-in' }
  | { kind: 'no-resume'; name: string }
  | { kind: 'done'; ok: number; fail: number; skipped: number };

/** Темп цикла откликов: паузы между вакансиями (значения читает composition root из env). */
export interface ApplySettings {
  minDelayMs: number;
  maxDelayMs: number;
}

/** Зависимости шага отклика — только порты. */
export interface ApplyDeps {
  /** Дайджест за сегодня (latest) или все сохранённые (all). */
  digests: DigestRepository;
  /** Письма из cacheCoverLetters: без письма вакансия пропускается. */
  letters: CoverLetterCache;
  /** История откликов: реальный отклик пропускается, digest-only отметка — нет. */
  history: HistoryStore;
  /** Сессия браузера: открыть/закрыть — забота адаптера. */
  gateway: ApplicationGateway;
  /** Ручной вход на hh.ru (пункт меню «🔑 Войти на hh.ru»). */
  login: LoginGateway;
  /** Резюме из opts.resume: по нему выбирается дайджест и письма (без него — все резюме). */
  resumeFiles: ResumeProvider;
  settings: ApplySettings;
}
