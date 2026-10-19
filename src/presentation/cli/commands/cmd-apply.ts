// Команда apply: отклик через Playwright — тонкая оболочка над application/apply.ts.
// Сценарий сам грузит дайджест, проверяет письма/авторизацию и ведёт цикл откликов.
import { runApply } from "../../../application/apply.js";

export default async function apply(opts: Record<string, any> = {}) {
  const outcome = await runApply(opts);
  // Единственная реакция команды: неудачная авторизация — ненулевой код возврата.
  if (outcome.kind === 'not-logged-in') process.exitCode = 1;
}
