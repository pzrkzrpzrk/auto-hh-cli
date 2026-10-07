// Интерактивное меню: список пунктов, диспетчеризация и обработка Ctrl+C.
// Меню ничего не делает само — оно собирает ответы (ui/steps.ts) и вызывает существующие cmd-*.
import { confirm, select, Separator } from "@inquirer/prompts";
import cmdApply from "../cmd-apply.js";
import cmdDigest from "../cmd-digest.js";
import cmdHistory from "../cmd-history.js";
import cmdConfig from "../cmd-config.js";
import {
  runActualize,
  runApply,
  runCover,
  runDigest,
  runGrade,
  runLetters,
  runReset,
  runResumeMenu,
  runSchedule,
  runSearch,
} from "./steps.js";
import { describeActiveResume, type UiContext } from "./resume.js";

type MenuItem =
  | "search"
  | "digest"
  | "digestShow"
  | "actualize"
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
function isPromptCancelled(err: any): boolean {
  return err?.name === "ExitPromptError";
}

/**
 * Меню требует TTY: без него не работает ни raw-режим stdin, ни стрелки.
 * В CI/пайпе команда просто печатает подсказку и завершается с кодом 0.
 */
function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
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
      { name: "♻️  Актуализировать старые дайджесты", value: "actualize" },
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

async function dispatch(ctx: UiContext, item: MenuItem) {
  switch (item) {
    case "search": return runSearch();
    case "digest": return runDigest(ctx);
    case "letters": return runLetters(ctx);
    case "apply": return runApply();
    case "login": return cmdApply({ login: true });
    case "digestShow": {
      const json = await confirm({ message: "Вывести в JSON?", default: false });
      console.log();
      return cmdDigest("show", { json });
    }
    case "actualize": return runActualize();
    case "history": {
      const json = await confirm({ message: "Вывести в JSON?", default: false });
      console.log();
      return cmdHistory({ json });
    }
    case "resume": return runResumeMenu(ctx);
    case "grade": return runGrade(ctx);
    case "cover": return runCover(ctx);
    case "schedule": return runSchedule(ctx);
    case "config": return cmdConfig();
    case "reset": return runReset();
    default: return undefined;
  }
}

export default async function cmdUi() {
  if (!isInteractive()) {
    console.log("Интерактивное меню требует терминал (TTY) — stdin или stdout перенаправлены.");
    console.log("Запустите его в обычной консоли либо используйте команды напрямую: auto-hh --help");
    return;
  }

  // Состояние сессии меню: пока процесс жив, помним только выбранное резюме.
  const ctx: UiContext = { activeResume: null };

  console.log("\n=== auto-hh — интерактивное меню ===");
  console.log("Ctrl+C — выход\n");

  try {
    for (;;) {
      console.log(`Резюме: ${describeActiveResume(ctx)}`);
      const item = await mainMenu();
      if (item === "exit") break;

      try {
        await dispatch(ctx, item);
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
