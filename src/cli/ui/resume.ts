// Резюме в меню: активное резюме сессии, подпись из .env и единый список choices.
// Состояние сессии живёт в ctx (создаёт его ui/menu.ts) — модульных переменных здесь нет.
import { input, select } from "@inquirer/prompts";
import { listResumes, loadResume } from "../../resume.js";

// Значение «резюме не указано»: команда сама возьмёт RESUME_PATH или первый файл из RESUMES_DIR.
const DEFAULT_RESUME = "__default__";
// Значение «ввести имя вручную» — нужно, когда RESUMES_DIR пуст.
const MANUAL_RESUME = "__manual__";

export type ActiveResume = { name: string; filename: string };

/** Состояние сессии меню: выбранное резюме и кэш подписи резюме из .env. */
export type UiContext = {
  /** Активное резюме сессии: живёт только в памяти, на диск ничего не пишем. */
  activeResume: ActiveResume | null;
  /** Подпись резюме из .env (undefined = ещё не вычисляли). */
  envResumeLabel?: string | null;
};

/** Подпись резюме, которое подставит .env (RESUME_PATH, затем первый из RESUMES_DIR). */
export function describeEnvResume(ctx: UiContext): string {
  if (ctx.envResumeLabel === undefined) {
    try {
      const r = loadResume();
      ctx.envResumeLabel = r ? `${r.name} (${r.filename})` : null;
    } catch {
      ctx.envResumeLabel = null;
    }
  }
  return ctx.envResumeLabel ?? "не найдено";
}

/** Что сейчас используется: активное резюме сессии или дефолт из .env. */
export function describeActiveResume(ctx: UiContext): string {
  if (ctx.activeResume) return `${ctx.activeResume.name} (${ctx.activeResume.filename})`;
  return `как в .env — ${describeEnvResume(ctx)}`;
}

/**
 * Единственное место сборки `choices` для резюме (D8: раньше список собирался дважды).
 * Порядок: «как в .env» → файлы из RESUMES_DIR (активное помечено) → ручной ввод.
 */
export function resumeChoices(
  files: { name: string; filename: string }[],
  opts: {
    active: ActiveResume | null;
    /** Подпись резюме из .env для первого пункта. */
    envLabel: string;
    /** Пометка активного резюме: у шага и у пункта меню подписи разные. */
    markLabel?: string;
    /** `auto` — ручной ввод только при пустом RESUMES_DIR, `always` — всегда. */
    manual?: "auto" | "always";
  },
): { choices: { name: string; value: string }[]; defaultValue: string } {
  const { active, envLabel, markLabel = "", manual = "auto" } = opts;
  const choices: { name: string; value: string }[] = [
    { name: `как в .env — ${envLabel}`, value: DEFAULT_RESUME },
  ];
  for (const f of files) {
    const mark = active && active.name === f.name ? markLabel : "";
    choices.push({ name: `${f.name}  (${f.filename})${mark}`, value: f.name });
  }
  if (manual === "always" || !files.length) {
    choices.push({ name: "ввести имя резюме вручную", value: MANUAL_RESUME });
  }

  const isActiveListed = files.some(f => f.name === active?.name);
  return { choices, defaultValue: isActiveListed && active ? active.name : choices[0].value };
}

/**
 * Выбор резюме списком; undefined = «как настроено в .env».
 * Активное резюме сессии предлагается по умолчанию и помечается пометкой.
 */
export async function pickResume(ctx: UiContext, message: string): Promise<string | undefined> {
  const { choices, defaultValue } = resumeChoices(listResumes(), {
    active: ctx.activeResume,
    envLabel: describeEnvResume(ctx),
    markLabel: "   ← активное",
  });

  const value = await select({ message, choices, default: defaultValue });

  if (value === DEFAULT_RESUME) return undefined;
  if (value === MANUAL_RESUME) return askResumeName(message);
  return value;
}

/** Пункт меню «Резюме → выбрать активное»: задаёт резюме для digest/cover/grade/schedule. */
export async function runPickActiveResume(ctx: UiContext) {
  const { choices, defaultValue } = resumeChoices(listResumes(), {
    active: ctx.activeResume,
    envLabel: describeEnvResume(ctx),
    markLabel: "   ← сейчас",
    manual: "always",
  });

  const value = await select({
    message: "Какое резюме сделать активным для меню?",
    choices,
    default: defaultValue,
  });

  if (value === DEFAULT_RESUME) {
    ctx.activeResume = null;
    console.log(`Активное резюме: как в .env — ${describeEnvResume(ctx)}`);
    return;
  }

  const name = value === MANUAL_RESUME ? await askResumeName("Имя резюме") : value;
  try {
    const resume = loadResume(name);
    if (!resume) {
      console.error(`Резюме "${name}" не найдено — проверьте RESUMES_DIR.`);
      return;
    }
    ctx.activeResume = { name: resume.name, filename: resume.filename };
    console.log(`Активное резюме: ${ctx.activeResume.name} (${ctx.activeResume.filename})`);
  } catch (err: any) {
    console.error(err?.message || err);
  }
}

/** Имя резюме: списком, если RESUMES_DIR заполнен, иначе — ручным вводом. */
export async function askResumeName(message: string): Promise<string> {
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
