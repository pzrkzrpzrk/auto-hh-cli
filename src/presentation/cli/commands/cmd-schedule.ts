// Команда schedule: тонкая оболочка над application/schedule.ts.
// Здесь только состав шагов (команды пайплайна) и печать фаз расписания.
import { runSchedule, type ScheduleEvent } from "../../../application/schedule.js";
import { configProvider } from "../../../composition.js";
import search from "./cmd-search.js";
import digest from "./cmd-digest.js";
import cover from "./cmd-cover.js";

// Шаги пайплайна: ключ — имя в config.schedule.steps.
const STEPS = {
  search: (opts: Record<string, any> = {}) => search(opts),
  digest: (opts: Record<string, any> = {}) => digest("build", opts),
  cover: (opts: Record<string, any> = {}) => cover(undefined, opts),
};

function printEvent(e: ScheduleEvent) {
  switch (e.type) {
    case 'pipeline-start':
      console.log(`\n=== Запуск пайплайна по расписанию (${e.at}) ===`);
      return;
    case 'step-completed':
      console.log(`✅ ${e.step} завершён (${e.at})`);
      return;
    case 'step-failed':
      console.error(`❌ Ошибка шага ${e.step}:`, e.message);
      return;
    case 'next-run':
      console.log(`⏰ Следующий запуск: ${e.at.toLocaleString("ru-RU")}\n`);
      return;
    default:
      return;
  }
}

export default async function cmdSchedule(opts: Record<string, any> = {}) {
  const outcome = await runSchedule(opts, { config: configProvider, steps: STEPS }, printEvent);

  if (outcome.kind === 'no-cron') {
    console.error("schedule.cron не задан в config.json");
    process.exitCode = 1;
    return;
  }
  if (outcome.kind === 'invalid-cron') {
    console.error(`Невалидное cron-выражение: ${outcome.expression}`);
    process.exitCode = 1;
    return;
  }

  const nextStr = outcome.next ? outcome.next.toLocaleString("ru-RU") : "неизвестно";
  console.log(`Планировщик запущен. Расписание: ${outcome.expression}`);
  console.log(`Шаги: ${outcome.steps.join(" → ")}`);
  console.log(`Резюме: ${outcome.resume ? outcome.resume : "не задано — берётся из .env"}`);
  console.log(`Следующий запуск: ${nextStr}`);
  console.log("Для остановки нажмите Ctrl+C\n");
}
