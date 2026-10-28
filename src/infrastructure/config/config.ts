// Загрузка конфигурации из JSON и .env.
import fs from "fs";
import path from "path";
import { intFromEnv } from "@/infrastructure/config/env.js";
import type { AppConfig, ConfigProvider } from "@/domain/ports.js";

// Личный список компаний из .env (через запятую). Пустая переменная = null,
// тогда работает список из config.json → filter.excludedCompanies.
function excludedCompaniesFromEnv(): string[] | null {
  const raw = process.env.EXCLUDED_COMPANIES;
  if (!raw || !raw.trim()) return null;

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.length ? out : null;
}

/** Прочитать и разобрать один файл конфигурации (без кэша). */
function readConfig(absPath: string): AppConfig {
  if (!fs.existsSync(absPath)) {
    throw new Error(`Config not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  const cfg = JSON.parse(raw) as AppConfig;

  // Личный блэклист компаний держим в .env, чтобы он не попадал в git.
  const excludedCompanies = excludedCompaniesFromEnv();
  if (excludedCompanies) {
    cfg.filter = { ...(cfg.filter || {}), excludedCompanies };
  }

  return cfg;
}

/**
 * Адаптер конфигурации: путь приходит параметром, `CONFIG_PATH` — только дефолт.
 * Один экземпляр кэширует результат по абсолютному пути, поэтому повторные вызовы
 * в рамках прогона не читают диск заново и не делят состояние через env.
 */
export class FileConfigProvider implements ConfigProvider {
  private readonly cache = new Map<string, AppConfig>();

  load(configPath?: string): AppConfig {
    const requested = configPath?.trim() || process.env.CONFIG_PATH || './config.json';
    const absPath = path.resolve(requested);
    const cached = this.cache.get(absPath);
    if (cached) return cached;

    const cfg = readConfig(absPath);
    this.cache.set(absPath, cfg);
    return cfg;
  }
}

/** Один провайдер на процесс: config.json читается один раз на путь. */
export const configProvider: ConfigProvider = new FileConfigProvider();

// Переменные, которые читает hh-адаптер (сессия браузера). OAuth-поля не нужны:
// вход выполняется вручную в профиле Chromium, токены не используются.
function env() {
  return {
    userAgent: process.env.HH_USER_AGENT || 'AutoHH/1.0',
    requestDelayMs: intFromEnv('REQUEST_DELAY_MS', 1500),
  };
}

export { env };
