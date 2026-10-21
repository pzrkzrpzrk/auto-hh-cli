// Сценарий актуализации (Facade): помечает в старых дайджестах и rejected вакансии,
// которых нет в последней выдаче. Ничего не удаляет — перезаписывает .md по регионам
// и пишет сводный снимок по всем прошлым датам в <today>/actual.md.
import { computeActualization, mergeActualized } from "@/domain/actualize.js";
import type { ActualizedDoc } from "@/domain/actualize.js";
import { flattenCollected } from "@/application/collect.js";
import log from "@/shared/logger.js";
import type { DigestRunOptions } from "@/domain/digest/types.js";
import type { ResumeRef } from "@/domain/models.js";
import { ACTUALIZE_TARGETS } from "@/application/digest/ActualizeTarget.js";
import type { ActualizeDeps } from "@/application/digest/DigestDeps.js";

/** Резюме документа: null — legacy-документ без привязки (папка no-resume). */
function refOf(doc: { resumeId?: string | null; resumeName?: string | null }): ResumeRef | null {
  if (!doc.resumeId) return null;
  return { id: doc.resumeId, name: doc.resumeName || doc.resumeId };
}

/** Документы разных резюме пишутся в разные папки — actual.md собирается по группе. */
function groupByResume(docs: ActualizedDoc[]): { resume: ResumeRef | null; docs: ActualizedDoc[] }[] {
  const groups = new Map<string, { resume: ResumeRef | null; docs: ActualizedDoc[] }>();
  for (const doc of docs) {
    const key = doc.resumeId || '';
    const bucket = groups.get(key);
    if (bucket) bucket.docs.push(doc);
    else groups.set(key, { resume: refOf(doc), docs: [doc] });
  }
  return [...groups.values()];
}

export interface ActualizeResult {
  today: string;
  checkedTotal: number;
  markedTotal: number;
  snapshots: string[];
  dryRun: boolean;
}

export class ActualizeScenario {
  constructor(private readonly deps: ActualizeDeps) {}

  async run(opts: DigestRunOptions = {}): Promise<ActualizeResult | null> {
    const cfg = this.deps.config.load(opts.config);

    const cache = await this.deps.cacheStore.loadLatest().catch(() => null);
    if (!cache) {
      log.warn('Кэш поиска пуст — сначала выполните пункт меню «🔍 Поиск вакансий»');
      return null;
    }

    const today = cache.date;
    const todayIds = new Set<string>(flattenCollected(cache).map(item => String(item.id)));
    const searchPeriod = Number(cfg.search?.search_period) || null;
    log.info(`Актуализация по поиску от ${today}: ${todayIds.size} вакансий в выдаче`);

    let checkedTotal = 0;
    let markedTotal = 0;
    const snapshots: string[] = [];

    for (const target of ACTUALIZE_TARGETS) {
      const docs = await this.deps.digest.listDocs(target.kind).catch(() => [] as any[]);
      const { docs: updated, stats } = computeActualization(docs, { todayIds, today, searchPeriod });
      checkedTotal += stats.total;
      markedTotal += stats.marked;

      if (!stats.dates) {
        log.info(`${target.label}: старых дат нет`);
        continue;
      }

      const toWrite = updated.filter(d => d.changed);
      // Сводный снимок по всем прошлым датам (кроме сегодня) — свой actual.md на каждое резюме.
      if (!opts.dryRun) {
        for (const d of toWrite) {
          await this.deps.digest.save(target.kind, d.entries, d.date, refOf(d));
        }
        for (const group of groupByResume(updated)) {
          const actualFile = this.deps.digest.saveActual(target.kind, mergeActualized(group.docs), today, group.resume);
          if (actualFile) snapshots.push(actualFile);
        }
      }
      log.info(`${target.label}: ${stats.dates} дат, ${stats.total} вакансий, недоступно ${stats.marked}, `
        + `обновлено дат ${toWrite.length}${opts.dryRun ? ' (dry-run)' : ''}`);
    }

    return { today, checkedTotal, markedTotal, snapshots, dryRun: Boolean(opts.dryRun) };
  }
}
