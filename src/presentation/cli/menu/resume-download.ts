// Пункт «Резюме → скачать с hh.ru»: список резюме, выбор, форматы и активное резюме.
// Браузер открывается здесь один раз: список передаётся в команду, чтобы не
// навигация по /applicant/resumes не повторялась.
import { checkbox, confirm } from "@inquirer/prompts";
import { openResumeSource } from "../../../composition.js";
import cmdResumeDownload from "../commands/cmd-resume-download.js";
import { readResumeFile } from "../../../application/resume.js";
import { resumeDeps } from "../../../composition.js";
import type { UiContext } from "./resume.js";

export async function runResumeDownload(ctx: UiContext) {
  const session = openResumeSource();

  try {
    await session.open();
    const items = await session.listMyResumes();
    if (!items.length) {
      console.log("На hh.ru не найдено резюме (или страница не распознана).");
      return;
    }

    const chosen = await checkbox({
      message: "Какие резюме скачать?",
      required: true,
      choices: items.map(item => ({
        name: `${item.title}${item.status ? ` — ${item.status}` : ""}`,
        value: item.hash,
        checked: true,
      })),
    });
    if (!chosen.length) return;

    const pdf = await confirm({ message: "Скачать ещё и PDF-копию?", default: false });
    const overwrite = await confirm({ message: "Перезаписывать уже существующие файлы?", default: false });

    console.log();
    const results = await cmdResumeDownload({ source: session, resumes: items, hashes: chosen, pdf, overwrite });

    // Файлы могли появиться впервые — сбрасываем закэшированную подпись .env,
    // иначе в шапке меню останется «не найдено» до перезапуска.
    ctx.envResumeLabel = undefined;

    const target = results.find(result => result.name && !result.error);
    if (!target?.name) return;

    const makeActive = await confirm({
      message: `Сделать «${target.name}» активным резюме в меню?`,
      default: true,
    });
    if (!makeActive) return;

    const resume = readResumeFile(target.name, resumeDeps);
    if (!resume) {
      console.error(`Резюме «${target.name}» скачано, но не читается: проверьте RESUMES_DIR.`);
      return;
    }
    ctx.activeResume = { name: resume.name, filename: resume.filename };
    console.log(`Активное резюме: ${resume.name} (${resume.filename})`);
  } finally {
    await session.close();
  }
}
