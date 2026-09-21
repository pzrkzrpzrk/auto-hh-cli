// Точка входа CLI: интерактивное меню. Подкоманд у CLI нет — остальные шаги
// (search, digest, cover, apply, schedule, …) меню вызывает напрямую из cmd-*.
// Меню ничего не делает само — оно только собирает ответы и вызывает существующие cmd-*.
import { confirm, input, select, Separator } from "@inquirer/prompts";
import cmdSearch from "./cmd-search.js";
import cmdApply from "./cmd-apply.js";
import cmdDigest from "./cmd-digest.js";
import cmdHistory from "./cmd-history.js";
import cmdConfig from "./cmd-config.js";
import cmdReset from "./cmd-reset.js";
import cmdCover from "./cmd-cover.js";
import cmdSchedule from "./cmd-schedule.js";
import cmdGradeResume from "./cmd-grade-resume.js";
import cmdResume from "./cmd-resume.js";
import { listResumes, loadResume } from "../resume.js";

// Значение «резюме не указано»: команда сама возьмёт RESUME_PATH или первый файл из RESUMES_DIR.
const DEFAULT_RESUME = "__default__";
// Значение «ввести имя вручную» — нужно, когда RESUMES_DIR пуст.
const MANUAL_RESUME = "__manual__";

// Активное резюме сессии меню: живёт только в памяти, на диск ничего не пишем.
let activeResume: { name: string; filename: string } | null = null;
// Кэш подписи резюме из .env (undefined = ещё не вычисляли).
let envResumeLabel: string | null | undefined;

type MenuItem =
  | "search"
  | "digest"
  | "digestShow"
  | "letters"
  | "apply"
  | "login"
  | "history"
  | "resume"
  | "grade"
  | "cover"
  | "schedule"
  | "config"
  | "reset"
  | "exit";

/** Промпты @inquirer бросают ExitPromptError на Ctrl+C / Esc — это не ошибка приложения. */
export function isPromptCancelled(err: any): boolean {
  return err?.name === "ExitPromptError";
}

/**
 * Меню требует TTY: без него не работает ни raw-режим stdin, ни стрелки.
 * В CI/пайпе команда просто печатает подсказку и завершается с кодом 0.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/** Собирает opts для `search` (шаг только поиска): резюме и ИИ ему больше не нужны. */
export function buildSearchOptions(answers: { reset: boolean }): Record<string, any> {
  return { reset: answers.reset };
}

/** Собирает opts для `digest` (шаг отбора): limit=0 → лимит из config.json. */
export function buildDigestOptions(answers: {
  resume?: string;
  useAi: boolean;
  limit: number;
  dryRun?: boolean;
}): Record<string, any> {
  const opts: Record<string, any> = {
    resume: answers.resume,
    claude: answers.useAi,
    dryRun: answers.dryRun ?? false,
  };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}

/** Собирает opts для `cover` (шаг писем): limit=0 → все вакансии дайджеста. */
export function buildCoverOptions(answers: { resume?: string; force: boolean; limit: number }): Record<string, any> {
  const opts: Record<string, any> = { resume: answers.resume, force: answers.force };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}

/** Собирает opts для `apply` из ответов меню: limit=0 означает «без лимита». */
export function buildApplyOptions(answers: { type: string; limit: number }): Record<string, any> {
  const opts: Record<string, any> = { type: answers.type };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}

/** Подпись резюме, которое подставит .env (RESUME_PATH, затем первый из RESUMES_DIR). */
function describeEnvResume(): string {
  if (envResumeLabel === undefined) {
    try {
      const r = loadResume();
      envResumeLabel = r ? `${r.name} (${r.filename})` : null;
    } catch {
      envResumeLabel = null;
    }
  }
  return envResumeLabel ?? "не найдено";
}

/** Что сейчас используется: активное резюме сессии или дефолт из .env. */
export function describeActiveResume(): string {
  if (activeResume) return `${activeResume.name} (${activeResume.filename})`;
  return `как в .env — ${describeEnvResume()}`;
}

/**
 * Выбор резюме списком; undefined = «как настроено в .env».
 * Активное резюме сессии предлагается по умолчанию и помечается пометкой.
 */
async function pickResume(message: string, allowDefault = true): Promise<string | undefined> {
  const files = listResumes();
  const choices: { name: string; value: string }[] = [];

  if (allowDefault) {
    choices.push({ name: `как в .env — ${describeEnvResume()}`, value: DEFAULT_RESUME });
  }
  for (const f of files) {
    const mark = activeResume && activeResume.name === f.name ? "   ← активное" : "";
    choices.push({ name: `${f.name}  (${f.filename})${mark}`, value: f.name });
  }
  // RESUMES_DIR пуст — даём хотя бы ручной ввод, иначе выбор исчезает совсем.
  if (!files.length) {
    choices.push({ name: "ввести имя резюме вручную", value: MANUAL_RESUME });
  }

  const isActiveListed = files.some(f => f.name === activeResume?.name);
  const value = await select({
    message,
    choices,
    default: isActiveListed && activeResume ? activeResume.name : choices[0].value,
  });

  if (value === DEFAULT_RESUME) return undefined;
  if (value === MANUAL_RESUME) return askResumeName(message);
  return value;
}

/** Пункт меню «Резюме → выбрать активное»: задаёт резюме для digest/cover/grade/schedule. */
async function runPickActiveResume() {
  const files = listResumes();
  const choices: { name: string; value: string }[] = [
    { name: `как в .env — ${describeEnvResume()}`, value: DEFAULT_RESUME },
  ];
  for (const f of files) {
    const mark = activeResume && activeResume.name === f.name ? "   ← сейчас" : "";
    choices.push({ name: `${f.name}  (${f.filename})${mark}`, value: f.name });
  }
  choices.push({ name: "ввести имя резюме вручную", value: MANUAL_RESUME });

  const isActiveListed = files.some(f => f.name === activeResume?.name);
  const value = await select({
    message: "Какое резюме сделать активным для меню?",
    choices,
    default: isActiveListed && activeResume ? activeResume.name : DEFAULT_RESUME,
  });

  if (value === DEFAULT_RESUME) {
    activeResume = null;
    console.log(`Активное резюме: как в .env — ${describeEnvResume()}`);
    return;
  }

  const name = value === MANUAL_RESUME ? await askResumeName("Имя резюме") : value;
  try {
    const resume = loadResume(name);
    if (!resume) {
      console.error(`Резюме "${name}" не найдено — проверьте RESUMES_DIR.`);
      return;
    }
    activeResume = { name: resume.name, filename: resume.filename };
    console.log(`Активное резюме: ${activeResume.name} (${activeResume.filename})`);
  } catch (err: any) {
    console.error(err?.message || err);
  }
}

/** Имя резюме: списком, если RESUMES_DIR заполнен, иначе — ручным вводом. */
async function askResumeName(message: string): Promise<string> {
  const files = listResumes();
  if (files.length) {
    return select({
      message,
      choices: files.map(f => ({ name: `${f.name}  (${f.filename})`, value: f.name })),
    });
  }
  const name = await input({
    message: `${message} (RESUMES_DIR пуст — введите имя без расширения):`,
    validate: (v: string) => (v.trim() ? true : "Введите имя резюме"),
  });
  return name.trim();
}

/** Спрашивает неотрицательное число (0 = «как настроено» / без лимита). */
async function askCount(message: string, def = "0"): Promise<number> {
  const raw = await input({
    message,
    default: def,
    validate: (v: string) => (/^\d+$/.test(v.trim()) ? true : "Введите целое число ≥ 0"),
  });
  return parseInt(raw.trim(), 10);
}

async function runSearch() {
  const reset = await confirm({
    message: "Сбросить историю, кэш и дайджесты перед поиском? (необратимо)",
    default: false,
  });

  console.log();
  await cmdSearch(buildSearchOptions({ reset }));
}

async function runDigest() {
  const resume = await pickResume("Какое резюме использовать для оценки?");
  const useAi = await confirm({ message: "Использовать ИИ-судью?", default: true });
  const limit = await askCount("Максимум вакансий в дайджесте (0 — как в config.json):");

  console.log();
  await cmdDigest("build", buildDigestOptions({ resume, useAi, limit }));
}

async function runLetters() {
  const resume = await pickResume("Какое резюме использовать для писем?");
  const force = await confirm({ message: "Перегенерировать письма, даже если они уже есть?", default: false });
  const limit = await askCount("Сколько вакансий обработать (0 — все из дайджеста):");

  console.log();
  await cmdCover(undefined, buildCoverOptions({ resume, force, limit }));
}

async function runApply() {
  const type = await select({
    message: "Откуда брать вакансии для отклика?",
    choices: [
      { name: "latest — только сегодняшний дайджест (по умолчанию)", value: "latest" },
      { name: "all — все сохранённые дайджесты", value: "all" },
    ],
    default: "latest",
  });

  const limit = await askCount("Сколько вакансий обработать (0 — без лимита):");

  console.log();
  await cmdApply(buildApplyOptions({ type, limit }));
}

async function runResumeMenu() {
  const action = await select({
    message: `Резюме (активное: ${describeActiveResume()}):`,
    choices: [
      { name: "🎯 выбрать активное для меню", value: "pick" },
      new Separator(),
      { name: "list — показать доступные резюме", value: "list" },
      { name: "show — показать резюме", value: "show" },
      { name: "register — зарегистрировать в MongoDB", value: "register" },
      new Separator(),
      { name: "← назад", value: "back" },
    ],
  });

  if (action === "back") return;
  if (action === "pick") {
    console.log();
    await runPickActiveResume();
    return;
  }
  if (action === "list") {
    console.log();
    await cmdResume({ _: ["list"] });
    return;
  }

  const name = await askResumeName(action === "register" ? "Какое резюме зарегистрировать?" : "Какое резюме показать?");
  console.log();
  await cmdResume({ _: [action, name] });
}

async function runGrade() {
  const resume = await pickResume("Какое резюме оценить?");
  console.log();
  await cmdGradeResume({ resume });
}

async function runCover() {
  const vacancyId = await input({
    message: "ID вакансии (из ссылки hh.ru/vacancy/<id>):",
    validate: (v: string) => (v.trim() ? true : "Введите id вакансии"),
  });
  const resume = await pickResume("Какое резюме использовать для письма?");
  console.log();
  await cmdCover(vacancyId.trim(), { resume });
}

async function runSchedule() {
  const run = await confirm({
    message: `Запустить планировщик? Он блокирующий: выход — Ctrl+C. Резюме: ${describeActiveResume()}`,
    default: true,
  });
  if (!run) return;
  console.log();
  await cmdSchedule({ resume: activeResume?.name });
}

async function runReset() {
  const run = await confirm({
    message: "Удалить историю, кэш и дайджесты (файлы + MongoDB)? Действие необратимо.",
    default: false,
  });
  if (!run) {
    console.log("Сброс отменён.");
    return;
  }
  console.log();
  await cmdReset();
}

async function mainMenu(): Promise<MenuItem> {
  return select<MenuItem>({
    message: "auto-hh — что сделать?",
    pageSize: 15,
    choices: [
      { name: "🔍 Поиск вакансий (search)", value: "search" },
      { name: "🧠 Собрать дайджест (digest)", value: "digest" },
      { name: "✉️  Письма для дайджеста (cover)", value: "letters" },
      { name: "🚀 Отклики из дайджеста (apply)", value: "apply" },
      { name: "🔑 Войти на hh.ru (apply --login)", value: "login" },
      new Separator(),
      { name: "📄 Последний дайджест (digest show)", value: "digestShow" },
      { name: "🕓 История откликов (history)", value: "history" },
      { name: "🧾 Резюме (выбрать активное / list / show / register)", value: "resume" },
      { name: "🎯 Оценить резюме ИИ (grade)", value: "grade" },
      { name: "✉️  Письмо по id (cover <id>)", value: "cover" },
      new Separator(),
      { name: "⏰ Планировщик (schedule)", value: "schedule" },
      { name: "⚙️  Конфигурация (config)", value: "config" },
      { name: "🧹 Сброс данных (reset)", value: "reset" },
      new Separator(),
      { name: "⏹  Выход", value: "exit" },
    ],
  });
}

async function dispatch(item: MenuItem) {
  switch (item) {
    case "search": return runSearch();
    case "digest": return runDigest();
    case "letters": return runLetters();
    case "apply": return runApply();
    case "login": return cmdApply({ login: true });
    case "digestShow": {
      const json = await confirm({ message: "Вывести в JSON?", default: false });
      console.log();
      return cmdDigest("show", { json });
    }
    case "history": {
      const json = await confirm({ message: "Вывести в JSON?", default: false });
      console.log();
      return cmdHistory({ json });
    }
    case "resume": return runResumeMenu();
    case "grade": return runGrade();
    case "cover": return runCover();
    case "schedule": return runSchedule();
    case "config": return cmdConfig();
    case "reset": return runReset();
    default: return undefined;
  }
}

export default async function cmdUi() {
  if (!isInteractive()) {
    console.log("Интерактивное меню требует терминал (TTY) — stdin или stdout перенаправлены.");
    console.log("Запустите его в обычной консоли — например: npm start");
    return;
  }

  console.log("\n=== auto-hh — интерактивное меню ===");
  console.log("Ctrl+C — выход\n");

  try {
    for (;;) {
      console.log(`Резюме: ${describeActiveResume()}`);
      const item = await mainMenu();
      if (item === "exit") break;

      try {
        await dispatch(item);
      } catch (err: any) {
        // Ctrl+C внутри подменю — выходим из меню, остальное показываем и продолжаем.
        if (isPromptCancelled(err)) throw err;
        console.error(`\nОшибка: ${err?.message || err}\n`);
      }
    }
  } catch (err: any) {
    if (!isPromptCancelled(err)) {
      console.error(`Ошибка: ${err?.message || err}`);
      process.exitCode = 1;
    }
    return;
  } finally {
    // Промпт мог оставить stdin в raw-режиме — возвращаем терминал в нормальное состояние.
    try {
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(false);
      }
    } catch { /* stdin уже закрыт — ничего страшного */ }
  }

  console.log("Пока!");
}
