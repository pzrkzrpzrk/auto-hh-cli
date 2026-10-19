// Единая точка чтения и валидации переменных окружения.
// До этого parseInt(process.env.X || 'def', 10) был скопирован в 10 местах
// (config.ts, clients/db.ts, cmd-apply.ts, cmd-cover.ts, cmd-digest.ts).

interface IntBounds {
  /** Нижняя граница: значения меньше поднимаются до min. */
  min?: number;
  /** Верхняя граница: значения больше опускаются до max. */
  max?: number;
}

/**
 * Читает целое из env. Пустая или нечисловая переменная → def,
 * затем значение ограничивается диапазоном [min, max], если он задан.
 */
export function intFromEnv(name: string, def: number, { min, max }: IntBounds = {}): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  let value = Number.isFinite(parsed) ? parsed : def;
  if (min != null && value < min) value = min;
  if (max != null && value > max) value = max;
  return value;
}

/**
 * Читает положительное целое из env. Нечисловое, 0 или отрицательное значение → def.
 * В отличие от intFromEnv, 0 не поднимается до минимума, а заменяется дефолтом.
 */
export function positiveIntFromEnv(name: string, def: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : def;
}

const TRUE_VALUES = ['true', '1', 'yes', 'y', 'on'];
const FALSE_VALUES = ['false', '0', 'no', 'n', 'off'];

/** Читает булево из env: true/1/yes/on → true, false/0/no/off → false, иначе def. */
export function boolFromEnv(name: string, def = false): boolean {
  const raw = process.env[name];
  if (raw == null) return def;
  const value = raw.trim().toLowerCase();
  if (TRUE_VALUES.includes(value)) return true;
  if (FALSE_VALUES.includes(value)) return false;
  return def;
}
