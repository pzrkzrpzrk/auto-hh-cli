// Шаги меню: собрать ответы промптами и вызвать соответствующую команду.
// Шаги ничего не решают сами — вся логика остаётся в cmd-*; ctx несёт состояние сессии (резюме).
import { confirm, input, select, Separator } from "@inquirer/prompts";
import cmdSearch from "@/presentation/cli/commands/cmd-search.js";
import cmdApply from "@/presentation/cli/commands/cmd-apply.js";
import cmdDigest from "@/presentation/cli/commands/cmd-digest.js";
import cmdReset from "@/presentation/cli/commands/cmd-reset.js";
import cmdCover from "@/presentation/cli/commands/cmd-cover.js";
import cmdSchedule from "@/presentation/cli/commands/cmd-schedule.js";
import cmdGradeResume from "@/presentation/cli/commands/cmd-grade-resume.js";
import cmdResume from "@/presentation/cli/commands/cmd-resume.js";
import { buildApplyOptions, buildCoverOptions, buildDigestOptions, buildSearchOptions } from "@/presentation/cli/menu/options.js";
import { askResumeName, currentResumeName, describeActiveResume, pickResume, runPickActiveResume, type UiContext } from "@/presentation/cli/menu/resume.js";
import { runResumeDownload } from "@/presentation/cli/menu/resume-download.js";
import { readResumeFile } from "@/application/resume.js";
import { resumeDeps } from "@/composition.js";

/** Спрашивает неотрицательное число (0 = «как настроено» / без лимита). */
async function askCount(message: string, def = "0"): Promise<number> {
  const raw = await input({
    message,
    default: def,
    validate: (v: string) => (/^\d+$/.test(v.trim()) ? true : "Введите целое число ≥ 0"),
  });
  return parseInt(raw.trim(), 10);
}

export async function runSearch(ctx: UiContext) {
  const resume = await pickResume(ctx, "Какое резюме использовать для поиска?");
  const reset = await confirm({
    message: "Сбросить данные выбранного резюме (дайджесты, вердикты, письма, отклики) перед поиском? Кэш поиска тоже обновится — необратимо",
    default: false,
  });

  console.log();
  await cmdSearch(buildSearchOptions({ reset, resume }));
}

// Комбинированный шаг: собрать ответы промптами, затем прогнать search → digest подряд.
// Промпты задаются до запуска, чтобы сам прогон шёл без участия пользователя; падение
// поиска прерывает цепочку (ошибку покажет dispatch), дайджест на пустом кэше сам предупредит.
export async function runSearchDigest(ctx: UiContext) {
  const resume = await pickResume(ctx, "Какое резюме использовать для оценки?");
  const reset = await confirm({
    message: "Сбросить данные выбранного резюме (дайджесты, вердикты, письма, отклики) перед поиском? Кэш поиска тоже обновится — необратимо",
    default: false,
  });
  const useAi = await confirm({ message: "Использовать ИИ-судью?", default: true });
  const limit = await askCount("Максимум вакансий в дайджесте (0 — как в config.json):");

  console.log();
  await cmdSearch(buildSearchOptions({ reset, resume }));
  await cmdDigest("build", buildDigestOptions({ resume, useAi, limit }));
}

export async function runDigest(ctx: UiContext) {
  const resume = await pickResume(ctx, "Какое резюме использовать для оценки?");
  const useAi = await confirm({ message: "Использовать ИИ-судью?", default: true });
  const limit = await askCount("Максимум вакансий в дайджесте (0 — как в config.json):");

  console.log();
  await cmdDigest("build", buildDigestOptions({ resume, useAi, limit }));
}

/** Актуализация старых дайджестов/rejected по последнему поиску (без резюме и ИИ). */
export async function runActualize() {
  const dryRun = await confirm({
    message: "Только показать результат, без записи (dry-run)?",
    default: false,
  });

  console.log();
  await cmdDigest("actualize", { dryRun });
}

export async function runLetters(ctx: UiContext) {
  const resume = await pickResume(ctx, "Какое резюме использовать для писем?");
  const force = await confirm({ message: "Перегенерировать письма, даже если они уже есть?", default: false });
  const limit = await askCount("Сколько вакансий обработать (0 — все из дайджеста):");

  console.log();
  await cmdCover(undefined, buildCoverOptions({ resume, force, limit }));
}

export async function runApply(ctx: UiContext) {
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
  await cmdApply(buildApplyOptions({ type, limit, resume: currentResumeName(ctx) }));
}

export async function runResumeMenu(ctx: UiContext) {
  const action = await select({
    message: `Резюме (активное: ${describeActiveResume(ctx)}):`,
    choices: [
      { name: "🎯 выбрать активное для меню", value: "pick" },
      { name: "⬇️ скачать с hh.ru (Markdown, опционально PDF)", value: "download" },
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
    await runPickActiveResume(ctx);
    return;
  }
  if (action === "download") {
    console.log();
    await runResumeDownload(ctx);
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

export async function runGrade(ctx: UiContext) {
  const resume = await pickResume(ctx, "Какое резюме оценить?");
  console.log();
  await cmdGradeResume({ resume });
}

export async function runCover(ctx: UiContext) {
  const vacancyId = await input({
    message: "ID вакансии (из ссылки hh.ru/vacancy/<id>):",
    validate: (v: string) => (v.trim() ? true : "Введите id вакансии"),
  });
  const resume = await pickResume(ctx, "Какое резюме использовать для письма?");
  console.log();
  await cmdCover(vacancyId.trim(), { resume });
}

export async function runSchedule(ctx: UiContext) {
  const run = await confirm({
    message: `Запустить планировщик? Он блокирующий: выход — Ctrl+C. Резюме: ${describeActiveResume(ctx)}`,
    default: true,
  });
  if (!run) return;
  console.log();
  await cmdSchedule({ resume: ctx.activeResume?.name });
}

export async function runReset(ctx: UiContext) {
  const scope = await select({
    message: "Что сбросить?",
    choices: [
      { name: "только выбранное резюме (его данные и отклики)", value: "resume" },
      { name: "всё: история, кэш и дайджесты всех резюме", value: "all" },
      new Separator(),
      { name: "← назад", value: "back" },
    ],
    default: "resume",
  });
  if (scope === "back") return;

  if (scope === "all") {
    const run = await confirm({
      message: "Удалить ВСЁ (файлы + MongoDB)? Действие необратимо.",
      default: false,
    });
    if (!run) {
      console.log("Сброс отменён.");
      return;
    }
    console.log();
    await cmdReset();
    return;
  }

  // Точечный сброс: имя нужно конкретное, «как в .env» разворачиваем в файл по умолчанию.
  const picked = await pickResume(ctx, "Данные какого резюме сбросить?");
  const name = picked ?? readResumeFile(undefined, resumeDeps)?.name;
  if (!name) {
    console.error("Резюме не найдено — задайте RESUMES_DIR / RESUME_PATH.");
    return;
  }

  let label = name;
  try {
    const resume = readResumeFile(name, resumeDeps);
    if (!resume) throw new Error("not found");
    label = `${resume.name} (${resume.filename})`;
  } catch {
    console.error(`Резюме «${name}» не найдено — проверьте RESUMES_DIR.`);
    return;
  }

  const run = await confirm({
    message: `Удалить дайджесты, rejected, вердикты, письма и отклики резюме «${label}»? Исходный файл резюме останется.`,
    default: false,
  });
  if (!run) {
    console.log("Сброс отменён.");
    return;
  }

  console.log();
  await cmdReset({ resume: name });
}
