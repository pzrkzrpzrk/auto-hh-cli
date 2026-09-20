// Команда schedule: запуск пайплайна (search → digest → cover) по cron-расписанию.
import cron from "node-cron";
import {  loadConfig  } from "../config";
import log from "../logger";
import search from "./cmd-search.js";
import digest from "./cmd-digest.js";
import cover from "./cmd-cover.js";

// Шаги пайплайна: ключ — имя в config.schedule.steps.
const STEPS: Record<string, (opts?: Record<string, any>) => Promise<any>> = {
  search: (opts = {}) => search(opts),
  digest: (opts = {}) => digest("build", opts),
  cover: (opts = {}) => cover(undefined, opts),
};

const DEFAULT_STEPS = ["search", "digest", "cover"];

function resolveSteps(cfg: any): string[] {
  const steps = cfg.schedule?.steps;
  if (!Array.isArray(steps) || !steps.length) return DEFAULT_STEPS;
  return steps.map(s => String(s).toLowerCase());
}

function getNextDate(expression: string): Date | null {
  // minute hour day-of-month month day-of-week
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return null;

  // Простой перебор на 48 часов вперёд для поиска следующего совпадения
  const now = new Date();
  for (let i = 1; i <= 60 * 48; i++) {
    const d = new Date(now.getTime() + i * 60000);
    const min = d.getMinutes();
    const hour = d.getHours();
    const dom = d.getDate();
    const mon = d.getMonth() + 1;
    const dow = d.getDay();

    const match = (p: string, v: number) => {
      if (p === "*") return true;
      if (p.includes("*/")) {
        const step = parseInt(p.split("/")[1], 10);
        return step > 0 && v % step === 0;
      }
      if (p.includes("-")) {
        const [a, b] = p.split("-").map(Number);
        return v >= a && v <= b;
      }
      if (p.includes(",")) return p.split(",").map(Number).includes(v);
      return parseInt(p, 10) === v;
    };

    if (match(parts[0], min) && match(parts[1], hour) &&
        match(parts[2], dom) && match(parts[3], mon) &&
        match(parts[4], dow)) {
      return d;
    }
  }
  return null;
}

export default async function cmdSchedule() {
  const cfg = loadConfig();

  if (!cfg.schedule?.cron) {
    console.error("schedule.cron не задан в config.json");
    process.exit(1);
  }

  const expression = cfg.schedule.cron;
  const steps = resolveSteps(cfg);

  if (!cron.validate(expression)) {
    console.error(`Невалидное cron-выражение: ${expression}`);
    process.exit(1);
  }

  const next = getNextDate(expression);
  const nextStr = next ? next.toLocaleString("ru-RU") : "неизвестно";
  console.log(`Планировщик запущен. Расписание: ${expression}`);
  console.log(`Шаги: ${steps.join(" → ")}`);
  console.log(`Следующий запуск: ${nextStr}`);
  console.log("Для остановки нажмите Ctrl+C\n");

  cron.schedule(expression, async () => {
    const now = new Date().toISOString();
    console.log(`\n=== Запуск пайплайна по расписанию (${now}) ===`);

    for (const step of steps) {
      const run = STEPS[step];
      if (!run) {
        log.warn(`Unknown schedule step "${step}" — пропускаю`);
        continue;
      }
      log.info(`Scheduled step started: ${step}`);
      try {
        await run({});
        log.info(`Scheduled step completed: ${step}`);
        console.log(`✅ ${step} завершён (${new Date().toISOString()})`);
      } catch (err: any) {
        log.error(`Scheduled step "${step}" failed: ${err.message}`);
        console.error(`❌ Ошибка шага ${step}:`, err.message);
        break;
      }
    }

    const next2 = getNextDate(expression);
    if (next2) {
      console.log(`⏰ Следующий запуск: ${next2.toLocaleString("ru-RU")}\n`);
    }
  });
}
