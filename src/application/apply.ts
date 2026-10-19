// Сценарий отклика: загрузка дайджеста, проверка писем и авторизации, цикл откликов.
// Зависимости — только порты: Playwright, MongoDB и настройки подставляет composition root,
// поэтому сценарий можно прогнать с подставной сессией и хранилищами.
// Команда только запускает сценарий и выставляет код возврата.
import log from "../shared/logger.js";
import { sleep, rand, dateKey } from "../shared/time.js";
import type {
  ApplicationGateway,
  ApplicationSession,
  HistoryStore,
  LoginGateway,
} from "../domain/ports.js";
import type { CoverLetterCache, DigestRepository } from "../domain/digest/ports.js";
import type { DigestEntry } from "../domain/models.js";

/** Итог сценария: команда выставляет exitCode только при неудачной авторизации. */
export type ApplyOutcome =
  | { kind: 'login' }
  | { kind: 'not-logged-in' }
  | { kind: 'done'; ok: number; fail: number; skipped: number };

/** Темп цикла откликов: паузы между вакансиями (значения читает composition root из env). */
export interface ApplySettings {
  minDelayMs: number;
  maxDelayMs: number;
}

/** Зависимости шага отклика — только порты (DIP). */
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
  settings: ApplySettings;
}

async function loadDigest(type: string, deps: ApplyDeps): Promise<DigestEntry[]> {
  if (type === 'all') {
    log.info('Loading all digests');
    return deps.digests.all();
  }
  return deps.digests.byDate(dateKey());
}

/** Цикл откликов внутри уже открытой сессии: проверка входа → отклики → сводка. */
async function applyAll(
  session: ApplicationSession,
  planned: DigestEntry[],
  deps: ApplyDeps,
  applied: Record<string, any>,
): Promise<ApplyOutcome> {
  if (!await session.ensureLoggedIn()) {
    // process.exit() здесь оборвал бы finally в run() и незаписанные данные в Mongo.
    return { kind: 'not-logged-in' };
  }

  let ok = 0, fail = 0, skipped = 0;
  for (const entry of planned) {
    if (!entry.coverLetter) {
      log.warn(`Skip ${entry.id}: no cover letter`);
      skipped++;
      continue;
    }
    const rec = applied[entry.id];
    if (rec && !rec.digestOnly) {
      log.info(`Skip ${entry.id}: already applied`);
      continue;
    }
    try {
      const res = await session.apply(entry);
      if (res.ok) {
        await deps.history.markApplied(entry.id, { via: 'playwright', url: entry.url });
        ok++;
      } else {
        fail++;
      }
    } catch (err) {
      log.warn(`Apply failed for ${entry.id}: ${err.message}`);
      fail++;
    }
    await sleep(rand(deps.settings.minDelayMs, deps.settings.maxDelayMs));
  }

  log.info(`Done. ok=${ok}, fail=${fail}, skipped=${skipped}`);
  return { kind: 'done', ok, fail, skipped };
}

export async function runApply(opts: Record<string, any> = {}, deps: ApplyDeps): Promise<ApplyOutcome> {
  if (opts.login) {
    await deps.login.login();
    return { kind: 'login' };
  }

  const type = opts.type || 'latest';
  const loaded = await loadDigest(type, deps);
  // Актуализированные (шаг `digest actualize`) вакансии пропускаем: их уже нет в поиске.
  const entries = loaded.filter(e => !e.archived);
  if (loaded.length !== entries.length) {
    log.info(`Недоступных пропущено: ${loaded.length - entries.length}`);
  }

  if (opts.limit && Number.isFinite(opts.limit) && opts.limit > 0) {
    entries.splice(opts.limit);
    log.info(`Limit applied: ${opts.limit} vacancies`);
  }
  log.info(`${entries.length} vacancies in digest`);

  // Письма генерируются отдельным шагом (пункт меню «✉️ Письма для дайджеста») и лежат в cacheCoverLetters.
  const planned = await deps.letters.attach(entries);
  const withoutLetter = planned.filter(e => !e.coverLetter).length;
  if (withoutLetter) {
    log.warn(`${withoutLetter} вакансий без сопроводительного — пропускаю (сгенерируйте: пункт меню «✉️ Письма для дайджеста»)`);
  }

  // История — один раз на прогон: полная выгрузка на каждой итерации ничего не даёт.
  const applied = (await deps.history.load()).applied;

  // Браузер открывает и закрывает адаптер: сценарию остаётся цикл откликов.
  return deps.gateway.withSession(session => applyAll(session, planned, deps, applied));
}
