// Команда cover: сопроводительные письма — отдельный шаг пайплайна.
// Без id: письма для всех вакансий последнего дайджеста. С id: одно письмо для вакансии.
// Сценарий — в application/cover.ts, здесь только печать результата и код возврата.
import { coverDeps } from "@/composition.js";
import { runCover } from "@/application/cover.js";
import { fmtSalary } from "@/application/collect.js";
import type { Vacancy } from "@/domain/models.js";
import log from "@/shared/logger.js";

function printVacancy(full: Vacancy, vacancyId: string) {
  console.log(`\n=== ${full.name} @ ${full.employer?.name || '?'} ===`);
  console.log(`URL: ${full.alternate_url || `https://hh.ru/vacancy/${vacancyId}`}`);
  console.log(`Регион: ${full.area?.name || '—'}`);
  // Тот же формат ЗП, что и в дайджесте (раньше здесь была локальная копия fmtSalary).
  if (full.salary) console.log(`Зарплата: ${fmtSalary(full.salary)}`);
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

export default async function cover(vacancyId?: string, opts: Record<string, any> = {}) {
  const outcome = await runCover(
    vacancyId,
    opts,
    coverDeps,
    printVacancy,
  );

  switch (outcome.kind) {
    case 'no-resume':
    case 'not-found':
      // Причина уже в логе сценария; код возврата — как раньше.
      process.exitCode = 1;
      return;
    case 'no-letter':
      log.warn('No cover letter generated (API may be unavailable)');
      return;
    case 'one':
      console.log('--- COVER LETTER ---');
      console.log(outcome.letter);
      return;
    case 'digest':
      printLetters(outcome.entries, outcome.letters);
      return;
    default:
      return;
  }
}
