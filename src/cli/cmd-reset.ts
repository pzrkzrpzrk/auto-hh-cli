// Команда reset: сбросить историю, кэш и дайджесты.
import resetData, { formatResetSummary } from "../store/reset.js";

async function reset() {
  const summary = await resetData();
  const text = formatResetSummary(summary);
  console.log(text ? `Сброшено: ${text}` : 'Сбрасывать было нечего — данные пусты.');
}

export default reset;
