// Команда reset: сбросить историю, кэш и дайджесты (все или одного резюме).
import resetData, { formatResetSummary } from "@/application/reset.js";
import { resetDeps } from "@/composition.js";

async function reset(opts: Record<string, any> = {}) {
  const outcome = await resetData(resetDeps, opts);
  if (outcome.kind === 'not-found') {
    console.error(`Резюме «${outcome.name}» не найдено — проверьте RESUMES_DIR.`);
    process.exitCode = 1;
    return;
  }

  const text = formatResetSummary(outcome.summary);
  const scope = outcome.resume ? `резюме «${outcome.resume.name}»` : 'все данные';
  console.log(text ? `Сброшено (${scope}): ${text}` : `Сбрасывать было нечего — ${scope} пусты.`);
}

export default reset;
