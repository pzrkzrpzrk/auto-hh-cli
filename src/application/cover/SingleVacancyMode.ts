// Режим «одна вакансия»: карточка со страницы hh.ru → письмо → cacheCoverLetters.
// Шаблон и адаптация резюме приходят из CoverConfig, поэтому сценарий не читает config.json.
import log from "../../shared/logger.js";
import { buildCoverLetter } from "../../domain/cover-letter/index.js";
import type { AiProvider } from "../../domain/ports.js";
import type { Resume } from "../../domain/models.js";
import type { CoverConfig, CoverDeps, CoverOutcome, OnVacancy } from "./CoverDeps.js";
import type { CoverMode } from "./CoverMode.js";

export class SingleVacancyMode implements CoverMode {
  constructor(
    private readonly deps: CoverDeps,
    private readonly cfg: CoverConfig,
    private readonly ai: AiProvider | null,
    private readonly resume: Resume,
    private readonly vacancyId: string,
    private readonly onVacancy?: OnVacancy,
  ) {}

  /** Источник открывается только на время запроса карточки (RAII). */
  run(): Promise<CoverOutcome> {
    return this.deps.source.withSource(async source => {
      log.info(`Fetching vacancy ${this.vacancyId}...`);
      const full = await source.getVacancy(this.vacancyId);
      if (!full) {
        log.error(`Vacancy ${this.vacancyId} not found`);
        return { kind: 'not-found', vacancyId: this.vacancyId } as CoverOutcome;
      }

      // Печать заголовка — забота команды: сценарий отдаёт карточку колбэком.
      if (this.onVacancy) this.onVacancy(full, this.vacancyId);

      log.info('Generating cover letter...');
      const letter = await buildCoverLetter(
        this.ai,
        this.cfg.coverLetterTemplate,
        full,
        this.resume,
        this.cfg.adaptResume,
      );
      if (!letter) return { kind: 'no-letter' } as CoverOutcome;

      // Ошибка кэша не отменяет письмо: команда его напечатает, шаг apply — нет.
      await this.deps.letters.save(String(full.id), letter)
        .catch(err => log.warn(`saveLetter ${full.id}: ${err.message}`));
      return { kind: 'one', letter } as CoverOutcome;
    });
  }
}
