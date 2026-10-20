// Команда reset: сбросить историю, кэш и дайджесты.
import resetData, { formatResetSummary } from "@/application/reset.js";
import { resetDeps } from "@/composition.js";

async function reset() {
  const summary = await resetData(resetDeps);
  const text = formatResetSummary(summary);
  console.log(text ? `Сброшено: ${text}` : 'Сбрасывать было нечего — данные пусты.');
}

export default reset;
