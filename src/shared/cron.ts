// Разбор cron-выражения без внешних зависимостей: ближайшее совпадение в пределах 48 часов.
// Используется планировщиком (application/schedule.ts) для подсказки «следующий запуск».

function getNextDate(expression: string): Date | null {
  // minute hour day-of-month month day-of-week
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return null;

  // Простой перебор на 48 часов вперёд для поиска следующего совпадения
  const now = new Date();
  for (let i = 1; i <= 60 * 48; i++) {
    const d = new Date(now.getTime() + i * 60000);
    const min = d.getMinutes();
    const hour = d.getHours();
    const dom = d.getDate();
    const mon = d.getMonth() + 1;
    const dow = d.getDay();

    const match = (p: string, v: number) => {
      if (p === "*") return true;
      if (p.includes("*/")) {
        const step = parseInt(p.split("/")[1], 10);
        return step > 0 && v % step === 0;
      }
      if (p.includes("-")) {
        const [a, b] = p.split("-").map(Number);
        return v >= a && v <= b;
      }
      if (p.includes(",")) return p.split(",").map(Number).includes(v);
      return parseInt(p, 10) === v;
    };

    if (match(parts[0], min) && match(parts[1], hour) &&
        match(parts[2], dom) && match(parts[3], mon) &&
        match(parts[4], dow)) {
      return d;
    }
  }
  return null;
}

export { getNextDate };
