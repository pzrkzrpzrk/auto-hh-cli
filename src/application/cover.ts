// Сценарий сопроводительных писем: одна вакансия или весь последний дайджест.
// Зависимости — только порты: config.json, MongoDB и диск подставляет composition root.
// Печать остаётся в команде: сценарий возвращает результат, а карточку вакансии
// отдаёт в колбэк onVacancy — так порядок вывода в консоли не меняется.
import { buildCoverLetter, buildCoverLettersBatch } from "../domain/cover-letter/index.js";
import type { AiProvider, CollectDeps, SourceProvider } from "../domain/ports.js";
import type { CoverLetterCache, DigestRepository, ResumeProvider } from "../domain/digest/ports.js";
import type { DigestEntry, Resume, Vacancy } from "../domain/models.js";
import type { VacancySource } from "../domain/search/VacancySource.js";
import SearchCache from "./search/SearchCache.js";
import { VacancyCollector } from "./search/VacancyCollector.js";
import { AllVacanciesPolicy } from "./search/FullCardPolicy.js";
import log from "../shared/logger.js";

/** Настройки писем из config.json/env — читает composition root, сценарий их только использует. */
export interface CoverConfig {
  coverLetterTemplate?: string;
  /** Адаптировать резюме под каждую вакансию (config.adaptResume !== false). */
  adaptResume: boolean;
  /** Сколько вакансий уходит в один запрос к ИИ (COVER_BATCH_SIZE). */
  batchSize: number;
}

/** Зависимости сценария писем — только порты (DIP). */
export interface CoverDeps {
  /** Провайдер ИИ создаётся лениво — ровно там, где он нужен (как раньше). */
  ai: () => AiProvider | null;
  /** Шаблон письма, адаптация резюме и размер пачки. */
  config: () => CoverConfig;
  collect: CollectDeps;
  /** Источник вакансий с жизненным циклом (браузер открывается только при догрузке). */
  source: SourceProvider<VacancySource>;
  /** Чтение резюме с диска (RESUME_PATH / RESUMES_DIR). */
  resumeFiles: ResumeProvider;
  /** Последний дайджест и запись обновлённых писем. */
  digests: DigestRepository;
  /** Письма из cacheCoverLetters: чтение (с force) и запись. */
  letters: CoverLetterCache;
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
  resume: Resume,
  deps: CoverDeps,
  onVacancy?: OnVacancy,
): Promise<CoverOutcome> {
  const cfg = deps.config();
  return deps.source.withSource(async source => {
    log.info(`Fetching vacancy ${vacancyId}...`);
    const full = await source.getVacancy(vacancyId);
    if (!full) {
      log.error(`Vacancy ${vacancyId} not found`);
      return { kind: 'not-found', vacancyId };
    }

    if (onVacancy) onVacancy(full, vacancyId);

    log.info('Generating cover letter...');
    const letter = await buildCoverLetter(ai, cfg.coverLetterTemplate, full, resume, cfg.adaptResume);
    if (!letter) return { kind: 'no-letter' };

    await deps.letters.save(String(full.id), letter).catch(err => log.warn(`saveLetter ${full.id}: ${err.message}`));
    return { kind: 'one', letter };
  });
}

// Весь последний дайджест: письма генерируются батчами и сохраняются в кэш + дайджест.
async function coverDigest(
  ai: AiProvider | null,
  opts: Record<string, any>,
  resume: Resume,
  deps: CoverDeps,
): Promise<CoverOutcome> {
  const cfg = deps.config();
  const digest = await deps.digests.latest().catch(() => null);
  if (!digest || !digest.entries.length) {
    log.warn('Дайджест пуст — сначала соберите его: пункт меню «🧠 Собрать дайджест» (нужна MongoDB)');
    return { kind: 'empty' };
  }

  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : digest.entries.length;
  const entries = digest.entries.slice(0, limit);

  const letters = new Map<string, string>();
  const withLetters = await deps.letters.attach(entries, { force: Boolean(opts.force) }).catch(() => entries);
  for (const e of withLetters) if (e.coverLetter) letters.set(String(e.id), e.coverLetter);

  const pending = withLetters.filter(e => !e.coverLetter);
  log.info(`Вакансий: ${entries.length}, письма уже есть: ${entries.length - pending.length}, генерируем: ${pending.length}`);
  if (!pending.length) {
    return { kind: 'digest', entries, letters };
  }

  // Описания вакансий: сначала из кэша cacheFull, недостающие — со страницы hh.ru.
  const fullById = await deps.collect.cacheStore.getFullByVacancyIds(pending.map(e => e.id))
    .catch(() => ({} as Record<string, Vacancy>));
  const missing = pending.filter(e => !fullById[String(e.id)]).map(e => String(e.id));
  if (missing.length) {
    log.info(`Подгружаю описания вакансий: ${missing.length}`);
    // Общая догрузка карточек (та же, что в search/digest): письма пишем всем.
    await deps.source.withSource(async source => {
      const cache = new SearchCache({ date: '', pages: {}, fullById }, deps.collect.cacheStore);
      await new VacancyCollector(source, cache, deps.collect.history)
        .ensureFullCards(missing, AllVacanciesPolicy);
    });
  }

  const items = pending.filter(e => fullById[String(e.id)]).map(e => ({ vacancy: fullById[String(e.id)] }));
  if (!items.length) {
    log.warn('Нет описаний вакансий — письма не сгенерированы');
    return { kind: 'empty' };
  }

  const batchSize = cfg.batchSize;
  log.info(`Генерация писем пачками по ${batchSize} для ${items.length} вакансий`);
  const generated = await buildCoverLettersBatch(ai, resume, items, batchSize, async (partial) => {
    for (const [id, letter] of partial.entries()) {
      letters.set(id, letter);
      await deps.letters.save(id, letter).catch(err => log.warn(`saveLetter ${id}: ${err.message}`));
    }
  }, cfg.adaptResume);
  for (const [id, letter] of generated.entries()) letters.set(id, letter);

  const updated: DigestEntry[] = digest.entries.map(e => ({ ...e, coverLetter: letters.get(String(e.id)) || e.coverLetter || '' }));
  const ready = updated.filter(e => e.coverLetter).length;
  log.info(`Сопроводительных готово: ${ready}/${updated.length}`);

  if (ready) {
    const files = await deps.digests.save('digest', updated, digest.date)
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
  const cfg = deps.config();
  const resume = deps.resumeFiles.load(opts.resume);

  if (!resume) {
    log.error('RESUME_PATH / RESUMES_DIR не заданы — без резюме письма не генерируются');
    return { kind: 'no-resume' };
  }
  if (!cfg.coverLetterTemplate) {
    log.warn('apply.coverLetterTemplate не задан в config.json — используется только ИИ');
  }

  const id = vacancyId ? String(vacancyId).trim() : '';
  const ai = deps.ai();
  return id ? coverOne(ai, id, resume, deps, onVacancy) : coverDigest(ai, opts, resume, deps);
}

