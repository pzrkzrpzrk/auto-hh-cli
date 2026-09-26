// Команда cover: сопроводительные письма — отдельный шаг пайплайна.
// Без id: письма для всех вакансий последнего дайджеста. С id: одно письмо для вакансии.
import HHClient from "../clients/hh-client.js";
import { buildCoverLetter, buildCoverLettersBatch } from "../domain/cover-letter/index.js";
import { loadResume } from "../resume.js";
import { loadConfig } from "../config.js";
import * as collectCache from "../store/cache-store.js";
import { getLatestDigest, writeDigest } from "../store/digest-store.js";
import log from "../logger.js";

function printVacancy(full, vacancyId: string) {
  console.log(`\n=== ${full.name} @ ${full.employer?.name || '?'} ===`);
  console.log(`URL: ${full.alternate_url || `https://hh.ru/vacancy/${vacancyId}`}`);
  console.log(`Регион: ${full.area?.name || '—'}`);
  if (full.salary) {
    const parts = [];
    if (full.salary.from) parts.push(`от ${full.salary.from}`);
    if (full.salary.to) parts.push(`до ${full.salary.to}`);
    console.log(`Зарплата: ${parts.join(' ') || '?'} ${full.salary.currency || ''}`);
  }
  console.log();
}

function printLetters(entries: any[], letters: Map<string, string>) {
  for (const e of entries) {
    const letter = letters.get(String(e.id));
    if (!letter) continue;
    console.log(`\n--- ${e.title} @ ${e.employer} ---`);
    console.log(letter);
  }
}

// Одна вакансия: письмо печатается в консоль и кладётся в кэш (чтобы apply его увидел).
async function coverOne(vacancyId: string, opts: Record<string, any>, resume) {
  const cfg = loadConfig();
  const client = new HHClient();
  try {
    log.info(`Fetching vacancy ${vacancyId}...`);
    const full = await client.getVacancy(vacancyId);
    if (!full) {
      log.error(`Vacancy ${vacancyId} not found`);
      process.exitCode = 1;
      return;
    }

    printVacancy(full, vacancyId);

    log.info('Generating cover letter...');
    const letter = await buildCoverLetter(cfg.apply.coverLetterTemplate, full, resume);
    if (!letter) {
      log.warn('No cover letter generated (API may be unavailable)');
      return;
    }

    await collectCache.saveLetter(full.id, letter).catch(err => log.warn(`saveLetter ${full.id}: ${err.message}`));
    console.log('--- COVER LETTER ---');
    console.log(letter);
  } finally {
    await client.close?.();
  }
}

// Весь последний дайджест: письма генерируются батчами и сохраняются в кэш + дайджест.
async function coverDigest(opts: Record<string, any>, resume) {
  const digest = await getLatestDigest().catch(() => null);
  if (!digest || !digest.entries.length) {
    log.warn('Дайджест пуст — сначала соберите его: auto-hh digest (нужна MongoDB)');
    return;
  }

  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : digest.entries.length;
  const entries = digest.entries.slice(0, limit);

  const letters = new Map<string, string>();
  const withLetters = await collectCache.withCoverLetters(entries, { force: Boolean(opts.force) }).catch(() => entries);
  for (const e of withLetters) if (e.coverLetter) letters.set(String(e.id), e.coverLetter);

  const pending = withLetters.filter(e => !e.coverLetter);
  log.info(`Вакансий: ${entries.length}, письма уже есть: ${entries.length - pending.length}, генерируем: ${pending.length}`);
  if (!pending.length) {
    printLetters(entries, letters);
    return;
  }

  // Описания вакансий: сначала из кэша cacheFull, недостающие — со страницы hh.ru.
  const fullById = await collectCache.getFullByVacancyIds(pending.map(e => e.id)).catch(() => ({}));
  const missing = pending.filter(e => !fullById[String(e.id)]).map(e => String(e.id));
  if (missing.length) {
    log.info(`Подгружаю описания вакансий: ${missing.length}`);
    const client = new HHClient();
    try {
      for (const id of missing) {
        try {
          const full = await client.getVacancy(id);
          if (!full) {
            log.warn(`Пустая вакансия ${id}`);
            continue;
          }
          fullById[id] = full;
          await collectCache.saveFullVacancy(full).catch(() => {});
        } catch (err) {
          log.warn(`Не удалось получить вакансию ${id}: ${err.message}`);
        }
      }
    } finally {
      await client.close?.();
    }
  }

  const items = pending.filter(e => fullById[String(e.id)]).map(e => ({ vacancy: fullById[String(e.id)] }));
  if (!items.length) {
    log.warn('Нет описаний вакансий — письма не сгенерированы');
    return;
  }

  const batchSize = parseInt(process.env.COVER_BATCH_SIZE || '20', 10);
  log.info(`Генерация писем пачками по ${batchSize} для ${items.length} вакансий`);
  const generated = await buildCoverLettersBatch(resume, items, batchSize, async (partial) => {
    for (const [id, letter] of partial.entries()) {
      letters.set(id, letter);
      await collectCache.saveLetter(id, letter).catch(err => log.warn(`saveLetter ${id}: ${err.message}`));
    }
  });
  for (const [id, letter] of generated.entries()) letters.set(id, letter);

  const updated = digest.entries.map(e => ({ ...e, coverLetter: letters.get(String(e.id)) || e.coverLetter || '' }));
  const ready = updated.filter(e => e.coverLetter).length;
  log.info(`Сопроводительных готово: ${ready}/${updated.length}`);

  if (ready) {
    const file = await writeDigest(updated, digest.date)
      .catch(err => { log.warn(`Не удалось обновить дайджест: ${err.message}`); return null; });
    if (file) log.info(`Digest updated with cover letters: ${file}`);
  }

  printLetters(entries, letters);
}

async function cover(vacancyId?: string, opts: Record<string, any> = {}) {
  const cfg = loadConfig();
  const resume = loadResume(opts.resume);

  if (!resume) {
    log.error('RESUME_PATH / RESUMES_DIR не заданы — без резюме письма не генерируются');
    process.exitCode = 1;
    return;
  }
  if (!cfg.apply?.coverLetterTemplate) {
    log.warn('apply.coverLetterTemplate не задан в config.json — используется только ИИ');
  }

  const id = vacancyId ? String(vacancyId).trim() : '';
  return id ? coverOne(id, opts, resume) : coverDigest(opts, resume);
}

export default cover;
