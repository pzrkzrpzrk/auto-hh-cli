// Команда digest: выбор действия и подключение репортера.
// Оркестрация — в сценариях application/digest, тексты — в format/digest-report.
import { digestDeps, digestShowDeps, actualizeDeps } from "@/composition.js";
import { DigestScenario } from "@/application/digest/DigestScenario.js";
import { DigestShowScenario } from "@/application/digest/DigestShowScenario.js";
import { ActualizeScenario } from "@/application/digest/ActualizeScenario.js";
import { ConsoleDigestReporter, printActualize, printDigestShow } from "@/presentation/cli/format/digest-report.js";

const reporter = new ConsoleDigestReporter();

// Шаг digest: сценарий собирает дайджест, репортер печатает топ и подсказку про письма.
async function build(opts: Record<string, any> = {}) {
  await new DigestScenario(digestDeps, reporter).build(opts);
}

// Шаг показа: последний дайджест + письма из кэша (fallback — .md файл).
async function show(opts: Record<string, any> = {}) {
  printDigestShow(await new DigestShowScenario(digestShowDeps).run(), opts);
}

// Шаг актуализации: сценарий обновляет записи, печать итогов — в репорте.
async function actualize(opts: Record<string, any> = {}) {
  const result = await new ActualizeScenario(actualizeDeps).run(opts);
  if (result) printActualize(result);
}

const SHOW_ACTIONS = new Set(['show', 'last', 'latest', 'view']);
const ACTUALIZE_ACTIONS = new Set(['actualize', 'actualise', 'refresh', 'sync']);

export default async function cmdDigest(action: any = 'build', opts: Record<string, any> = {}) {
  // Совместимость с прежним вызовом cmdDigest({ json: true }) — это показ дайджеста.
  if (action && typeof action === 'object') {
    opts = action;
    action = 'show';
  }

  const name = String(action).toLowerCase();
  if (SHOW_ACTIONS.has(name)) return show(opts);
  if (ACTUALIZE_ACTIONS.has(name)) return actualize(opts);
  if (name === 'build' || name === 'make' || name === 'create') return build(opts);

  console.error(`Неизвестное действие "digest ${action}". Доступно: build (по умолчанию), show, actualize.`);
  process.exitCode = 1;
}
