// Консольный репортер дайджеста (Observer) и печать показа/актуализации.
// Сценарий сообщает события, тексты и форматирование живут здесь; команда только связывает.
import type { DigestEvent, DigestReporter } from "@/application/digest/DigestEvent.js";
import type { DigestShowOutcome } from "@/application/digest/DigestShowScenario.js";
import type { ActualizeResult } from "@/application/digest/ActualizeScenario.js";
import type { DigestEntry } from "@/application/digest.js";
import type { ShowOptions } from "@/application/options.js";
import log from "@/shared/logger.js";

const TOP_LIMIT = 10;

export class ConsoleDigestReporter implements DigestReporter {
  on(event: DigestEvent): void {
    switch (event.type) {
      case 'matched':
        this.printTop(event.matched);
        return;
      case 'digest-saved':
        this.printCoverHint();
        return;
    }
  }

  private printTop(matched: DigestEntry[]): void {
    if (!matched.length) return;
    console.log('\n=== TOP MATCHES ===');
    for (const e of matched.slice(0, TOP_LIMIT)) {
      const when = e.publishedAt ? ` | опубликована ${String(e.publishedAt).slice(0, 10)}` : '';
      console.log(`- [${e.score ?? '?'}/10] ${e.title} @ ${e.employer} | ${e.salary}${when}\n  ${e.url}`);
    }
  }

  private printCoverHint(): void {
    console.log('\nДальше: пункт меню «✉️ Письма для дайджеста» — сгенерировать сопроводительные');
  }
}

/** Печать исхода `digest show`: SQLite → карточки/JSON, файлы → содержимое, пусто → подсказка. */
export function printDigestShow(outcome: DigestShowOutcome, opts: ShowOptions = {}): void {
  if (outcome.kind === 'none') {
    log.info('No digest found. Сначала соберите дайджест: пункт меню «🧠 Собрать дайджест»');
    return;
  }
  if (outcome.kind === 'files') {
    for (const content of outcome.contents) console.log(content);
    return;
  }

  const { entries } = outcome;
  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(`\n=== Дайджест ${outcome.date} (${entries.length} вакансий) ===`);
  if (outcome.resumeLabel) console.log(`Резюме: ${outcome.resumeLabel}`);
  console.log('');
  for (const e of entries) {
    console.log(`[${e.score ?? '?'}/10] ${e.title} @ ${e.employer}`);
    console.log(`      ${e.salary || '—'} | ${e.area || '—'}`);
    if (e.publishedAt) console.log(`      Опубликована: ${String(e.publishedAt).slice(0, 10)}`);
    console.log(`      ${e.url}`);
    if (e.coverLetter) console.log(`      -> письмо: ${e.coverLetter.slice(0, 80)}...`);
    console.log();
  }
}

/** Печать итогов `digest actualize`. */
export function printActualize(result: ActualizeResult): void {
  console.log(`\nАктуализация (поиск от ${result.today}): проверено ${result.checkedTotal} вакансий, помечено недоступными ${result.markedTotal}${result.dryRun ? ' [dry-run]' : ''}`);
  if (result.snapshots.length && !result.dryRun) {
    console.log(`Сводные снимки актуальных вакансий: ${result.snapshots.join(', ')}`);
  }
  if (result.markedTotal && !result.dryRun) {
    console.log('Недоступные вакансии не берутся в отклики (пункт «🚀 Отклики из дайджеста»).');
  }
}
