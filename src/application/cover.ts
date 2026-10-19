// Сценарий сопроводительных писем: одна вакансия или весь последний дайджест.
// Печать остаётся в команде: сценарий возвращает результат, а карточку вакансии
// отдаёт в колбэк onVacancy — так порядок вывода в консоли не меняется.
import HHClient from "../infrastructure/hh/client.js";
import { buildCoverLetter, buildCoverLettersBatch } from "../domain/cover-letter/index.js";
import { loadResume } from "../infrastructure/files/resume-loader.js";
import { loadConfig } from "../infrastructure/config/config.js";
import { intFromEnv } from "../infrastructure/config/env.js";
import * as collectCache from "../infrastructure/mongo/cache-store.js";
import type { AiProvider, CollectDeps } from "../domain/ports.js";
import { ensureFullVacancies } from "./collect.js";
import { getLatestDigest, writeDigest } from "../infrastructure/mongo/digest-store.js";
import log from "../shared/logger.js";

/** Зависимости сценария: конкретные реализации подставляет команда (composition root). */
export interface CoverDeps {
  /** Провайдер ИИ создаётся лениво — ровно там, где он нужен (как раньше). */
  ai: () => AiProvider | null;
  collect: CollectDeps;
}

/** Итог сценария: команда превращает его в печать (и код возврата для ошибок). */
export type CoverOutcome =
  | { kind: 'no-resume' }
  | { kind: 'not-found'; vacancyId: string }
  | { kind: 'no-letter' }
  | { kind: 'one'; letter: string }
  | { kind: 'digest'; entries: any[]; letters: Map<string, string> }
  | { kind: 'empty' };

/** Карточка вакансии для печати заголовка (вызывается до генерации письма). */
export type OnVacancy = (full: any, vacancyId: string) => void;

// Одна вакансия: письмо кладётся в кэш, чтобы шаг apply его увидел.
async function coverOne(
  ai: AiProvider | null,
  vacancyId: string,
  opts: Record<string, any>,
  resume,
  onVacancy?: OnVacancy,
): Promise<CoverOutcome> {
  const cfg = loadConfig();
  const client = new HHClient();
  try {
    log.info(`Fetching vacancy ${vacancyId}...`);
    const full = await client.getVacancy(vacancyId);
    if (!full) {
      log.error(`Vacancy ${vacancyId} not found`);
      return { kind: 'not-found', vacancyId };
    }

    if (onVacancy) onVacancy(full, vacancyId);

    log.info('Generating cover letter...');
    const letter = await buildCoverLetter(ai, cfg.apply.coverLetterTemplate, full, resume, cfg.adaptResume !== false);
    if (!letter) return { kind: 'no-letter' };

    await collectCache.saveLetter(full.id, letter).catch(err => log.warn(`saveLetter ${full.id}: ${err.message}`));
    return { kind: 'one', letter };
  } finally {
    await client.close?.();
  }
}

// Весь последний дайджест: письма генерируются батчами и сохраняются в кэш + дайджест.
async function coverDigest(
  ai: AiProvider | null,
  opts: Record<string, any>,
  resume,
  deps: CoverDeps,
): Promise<CoverOutcome> {
  const cfg = loadConfig();
  const digest = await getLatestDigest().catch(() => null);
  if (!digest || !digest.entries.length) {
    log.warn('Дайджест пуст — сначала соберите его: пункт меню «🧠 Собрать дайджест» (нужна MongoDB)');
    return { kind: 'empty' };
  }

  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : digest.entries.length;
  const entries = digest.entries.slice(0, limit);

  const letters = new Map<string, string>();
  const withLetters = await collectCache.withCoverLetters(entries, { force: Boolean(opts.force) }).catch(() => entries);
  for (const e of withLetters) if (e.coverLetter) letters.set(String(e.id), e.coverLetter);

  const pending = withLetters.filter(e => !e.coverLetter);
  log.info(`Вакансий: ${entries.length}, письма уже есть: ${entries.length - pending.length}, генерируем: ${pending.length}`);
  if (!pending.length) {
    return { kind: 'digest', entries, letters };
  }

  // Описания вакансий: сначала из кэша cacheFull, недостающие — со страницы hh.ru.
  const fullById = await collectCache.getFullByVacancyIds(pending.map(e => e.id)).catch(() => ({} as Record<string, any>));
  const missing = pending.filter(e => !fullById[String(e.id)]).map(e => String(e.id));
  if (missing.length) {
    log.info(`Подгружаю описания вакансий: ${missing.length}`);
    const client = new HHClient();
    try {
      // Общая догрузка карточек (та же, что в search/digest): skipSeen не нужен — письма пишем всем.
      await ensureFullVacancies(client, missing, { fullById }, deps.collect);
    } finally {
      await client.close?.();
    }
  }

  const items = pending.filter(e => fullById[String(e.id)]).map(e => ({ vacancy: fullById[String(e.id)] }));
  if (!items.length) {
    log.warn('Нет описаний вакансий — письма не сгенерированы');
    return { kind: 'empty' };
  }

  const batchSize = intFromEnv('COVER_BATCH_SIZE', 20, { min: 1 });
  log.info(`Генерация писем пачками по ${batchSize} для ${items.length} вакансий`);
  const generated = await buildCoverLettersBatch(ai, resume, items, batchSize, async (partial) => {
    for (const [id, letter] of partial.entries()) {
      letters.set(id, letter);
      await collectCache.saveLetter(id, letter).catch(err => log.warn(`saveLetter ${id}: ${err.message}`));
    }
  }, cfg.adaptResume !== false);
  for (const [id, letter] of generated.entries()) letters.set(id, letter);

  const updated = digest.entries.map(e => ({ ...e, coverLetter: letters.get(String(e.id)) || e.coverLetter || '' }));
  const ready = updated.filter(e => e.coverLetter).length;
  log.info(`Сопроводительных готово: ${ready}/${updated.length}`);

  if (ready) {
    const files = await writeDigest(updated, digest.date)
      .catch(err => { log.warn(`Не удалось обновить дайджест: ${err.message}`); return null; });
    if (files?.length) log.info(`Digest updated with cover letters: ${files.join(', ')}`);
  }

  return { kind: 'digest', entries, letters };
}

/**
 * Точка входа сценария: с id — одно письмо, без id — весь последний дайджест.
 * Проверки резюме/шаблона и выбор пути остаются здесь, печать — в команде.
 */
export async function runCover(
  vacancyId: string | undefined,
  opts: Record<string, any>,
  deps: CoverDeps,
  onVacancy?: OnVacancy,
): Promise<CoverOutcome> {
  const cfg = loadConfig();
  const resume = loadResume(opts.resume);

  if (!resume) {
    log.error('RESUME_PATH / RESUMES_DIR не заданы — без резюме письма не генерируются');
    return { kind: 'no-resume' };
  }
  if (!cfg.apply?.coverLetterTemplate) {
    log.warn('apply.coverLetterTemplate не задан в config.json — используется только ИИ');
  }

  const id = vacancyId ? String(vacancyId).trim() : '';
  const ai = deps.ai();
  return id ? coverOne(ai, id, opts, resume, onVacancy) : coverDigest(ai, opts, resume, deps);
}

