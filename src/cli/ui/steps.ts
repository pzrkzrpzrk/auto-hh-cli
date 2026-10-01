// Шаги меню: собрать ответы промптами и вызвать соответствующую команду.
// Шаги ничего не решают сами — вся логика остаётся в cmd-*; ctx несёт состояние сессии (резюме).
import { confirm, input, select, Separator } from "@inquirer/prompts";
import cmdSearch from "../cmd-search.js";
import cmdApply from "../cmd-apply.js";
import cmdDigest from "../cmd-digest.js";
import cmdReset from "../cmd-reset.js";
import cmdCover from "../cmd-cover.js";
import cmdSchedule from "../cmd-schedule.js";
import cmdGradeResume from "../cmd-grade-resume.js";
import cmdResume from "../cmd-resume.js";
import { buildApplyOptions, buildCoverOptions, buildDigestOptions, buildSearchOptions } from "./options.js";
import { askResumeName, describeActiveResume, pickResume, runPickActiveResume, type UiContext } from "./resume.js";

/** Спрашивает неотрицательное число (0 = «как настроено» / без лимита). */
async function askCount(message: string, def = "0"): Promise<number> {
  const raw = await input({
    message,
    default: def,
    validate: (v: string) => (/^\d+$/.test(v.trim()) ? true : "Введите целое число ≥ 0"),
  });
  return parseInt(raw.trim(), 10);
}

export async function runSearch() {
  const reset = await confirm({
    message: "Сбросить историю, кэш и дайджесты перед поиском? (необратимо)",
    default: false,
  });

  console.log();
  await cmdSearch(buildSearchOptions({ reset }));
}

export async function runDigest(ctx: UiContext) {
  const resume = await pickResume(ctx, "Какое резюме использовать для оценки?");
  const useAi = await confirm({ message: "Использовать ИИ-судью?", default: true });
  const limit = await askCount("Максимум вакансий в дайджесте (0 — как в config.json):");

  console.log();
  await cmdDigest("build", buildDigestOptions({ resume, useAi, limit }));
}

export async function runLetters(ctx: UiContext) {
  const resume = await pickResume(ctx, "Какое резюме использовать для писем?");
  const force = await confirm({ message: "Перегенерировать письма, даже если они уже есть?", default: false });
  const limit = await askCount("Сколько вакансий обработать (0 — все из дайджеста):");

  console.log();
  await cmdCover(undefined, buildCoverOptions({ resume, force, limit }));
}

export async function runApply() {
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

export async function runResumeMenu(ctx: UiContext) {
  const action = await select({
    message: `Резюме (активное: ${describeActiveResume(ctx)}):`,
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
    await runPickActiveResume(ctx);
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

export async function runReset() {
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
