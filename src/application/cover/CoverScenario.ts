// Сценарий писем (Facade): проверки входа → стратегия режима → результат.
// Раньше здесь же лежали обе ветки (одна вакансия и весь дайджест); теперь сценарий
// отвечает только за общие проверки и выбор стратегии, а работа — в режимах.
import log from "../../shared/logger.js";
import type { AiProvider } from "../../domain/ports.js";
import type { Resume } from "../../domain/models.js";
import type { CoverConfig, CoverDeps, CoverOutcome, OnVacancy } from "./CoverDeps.js";
import type { CoverMode } from "./CoverMode.js";
import { DigestCoverMode } from "./DigestCoverMode.js";
import { SingleVacancyMode } from "./SingleVacancyMode.js";

export class CoverScenario {
  constructor(private readonly deps: CoverDeps) {}

  /**
   * С id — одно письмо, без id — весь последний дайджест.
   * Поведение прежнего runCover: те же проверки резюме/шаблона и те же исходы.
   */
  async run(
    vacancyId: string | undefined,
    opts: Record<string, any>,
    onVacancy?: OnVacancy,
  ): Promise<CoverOutcome> {
    const cfg = this.deps.config(opts.config);
    const resume = this.deps.resumeFiles.load(opts.resume);

    if (!resume) {
      log.error('RESUME_PATH / RESUMES_DIR не заданы — без резюме письма не генерируются');
      return { kind: 'no-resume' };
    }
    if (!cfg.coverLetterTemplate) {
      log.warn('apply.coverLetterTemplate не задан в config.json — используется только ИИ');
    }

    const id = vacancyId ? String(vacancyId).trim() : '';
    const ai = this.deps.ai(opts.config);
    const mode = this.selectMode(id, opts, cfg, resume, ai, onVacancy);
    return mode.run();
  }

  /** Стратегия режима: наличие id решает, что запускать. */
  private selectMode(
    id: string,
    opts: Record<string, any>,
    cfg: CoverConfig,
    resume: Resume,
    ai: AiProvider | null,
    onVacancy?: OnVacancy,
  ): CoverMode {
    return id
      ? new SingleVacancyMode(this.deps, cfg, ai, resume, id, onVacancy)
      : new DigestCoverMode(this.deps, cfg, ai, resume, opts);
  }
}
