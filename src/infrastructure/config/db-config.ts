// Конфигурация SQLite: путь к файлу и настройки соединения — из окружения.
// Разрешение конфигурации живёт рядом с остальными config-адаптерами (env.ts,
// apply-config.ts, cover-config.ts): менеджер соединения должен знать только
// «какой файл открыть и с какими PRAGMA», а не откуда взялся путь.
import path from "path";
import { DATA_DIR } from "@/infrastructure/config/paths.js";
import { intFromEnv } from "@/infrastructure/config/env.js";

/** Всё, что подключение берёт из окружения. Тесты передают свои значения в connect(). */
export interface DbSettings {
  /** Файл БД: SQLITE_PATH, data/autohh.db или ':memory:'. */
  file: string;
  /** PRAGMA busy_timeout: второй процесс не роняет команду «database is locked». */
  busyTimeoutMs: number;
  /** Окно TTL истории в днях (раньше — TTL-индекс Mongo). */
  historyTtlDays: number;
}

/** В Mongo история просмотров жила с TTL 180 дней — здесь чистим разово при открытии. */
const HISTORY_TTL_DAYS = 180;

// Относительный путь считается от корня проекта, а не от cwd: команду можно
// запускать из любой папки. ':memory:' поддерживается — так адаптеры проверяются
// без файла на диске.
function resolveDbFile(configured?: string): string {
  if (!configured) return path.join(DATA_DIR, 'autohh.db');
  if (configured === ':memory:') return configured;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(path.dirname(DATA_DIR), configured);
}

/** Настройки БД на момент вызова: env читается при подключении, а не при импорте. */
export function dbSettings(): DbSettings {
  return {
    file: resolveDbFile(process.env.SQLITE_PATH),
    busyTimeoutMs: intFromEnv('SQLITE_BUSY_TIMEOUT_MS', 5000, { min: 0 }),
    historyTtlDays: HISTORY_TTL_DAYS,
  };
}
