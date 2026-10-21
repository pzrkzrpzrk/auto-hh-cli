// Команда apply: отклик через Playwright — тонкая оболочка над application/apply.ts.
// Сценарий сам грузит дайджест, проверяет письма/авторизацию и ведёт цикл откликов;
// зависимости (Playwright, Mongo) приходят из composition root.
import { applyDeps } from "@/composition.js";
import { runApply } from "@/application/apply.js";

export default async function apply(opts: Record<string, any> = {}) {
  const outcome = await runApply(opts, applyDeps);
  // Единственная реакция команды: неудачная авторизация/резюме — ненулевой код возврата.
  if (outcome.kind === 'not-logged-in') process.exitCode = 1;
  if (outcome.kind === 'no-resume') {
    console.error(`Резюме «${outcome.name}» не найдено — проверьте RESUMES_DIR.`);
    process.exitCode = 1;
  }
}
