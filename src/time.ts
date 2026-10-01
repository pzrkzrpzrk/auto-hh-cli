// Время и задержки: единые sleep/rand/dateKey вместо двух копий sleep и трёх копий dateKey.

/** Пауза на ms миллисекунд. */
export function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => { setTimeout(resolve, ms); });
}

/** Случайное целое из диапазона [min, max] включительно. */
export function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Ключ даты YYYY-MM-DD в UTC — то же, что раньше давал toISOString().slice(0, 10). */
export function dateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
