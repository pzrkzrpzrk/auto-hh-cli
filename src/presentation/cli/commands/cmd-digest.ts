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
  printDigestShow(await new DigestShowScenario(digestShowDeps).run(opts), opts);
}

// Шаг актуализации: сценарий обновляет записи, печать итогов — в репорте.
async function actualize(opts: Record<string, any> = {}) {
  const result = await new ActualizeScenario(actualizeDeps).run(opts);
  if (result) printActualize(result);
}

/** Действие пункта меню: подкоманд у CLI нет, поэтому действие приходит строкой. */
export type DigestAction = 'build' | 'show' | 'actualize';

export default async function cmdDigest(action: DigestAction = 'build', opts: Record<string, any> = {}) {
  switch (action) {
    case 'show':
      return show(opts);
    case 'actualize':
      return actualize(opts);
    case 'build':
      return build(opts);
    default:
      // Строка приходит из меню/команды; ветка нужна для внешних вызовов и опечаток.
      console.error(`Неизвестное действие "digest ${action}". Доступно: build (по умолчанию), show, actualize.`);
      process.exitCode = 1;
  }
}
