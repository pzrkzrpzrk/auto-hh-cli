// Загрузка конфигурации из JSON и .env.
import fs from "fs";
import path from "path";
import { intFromEnv } from "./env.js";

// Мемоизация: файл читается один раз на процесс, повторные вызовы из 5 модулей его не перечитывают.
// Ключ — абсолютный путь: если CONFIG_PATH меняется (`--config`), конфиг читается заново.
// Для принудительного перечитывания — loadConfig({ reload: true }).
let cached: any = null;
let cachedPath: string | null = null;

function loadConfig({ reload = false }: { reload?: boolean } = {}): any {
  const configPath = process.env.CONFIG_PATH || './config.json';
  const absPath = path.resolve(configPath);
  if (!reload && cached !== null && cachedPath === absPath) return cached;
  if (!fs.existsSync(absPath)) {
    throw new Error(`Config not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  cached = JSON.parse(raw);
  cachedPath = absPath;
  return cached;
}

// Секция api — вход ИИ-клиента. Объект мемоизируется по конфигу: getClient() кэширует клиент
// по ссылке на конфиг, поэтому при повторных вызовах должна возвращаться та же ссылка.
const apiCache = new WeakMap<object, any>();

function getApiConfig(): any {
  const cfg = loadConfig();
  if (!cfg || typeof cfg !== 'object') return {};
  if (!apiCache.has(cfg)) apiCache.set(cfg, cfg.api || {});
  return apiCache.get(cfg);
}

function env() {
  return {
    userAgent: process.env.HH_USER_AGENT || 'AutoHH/1.0',
    requestDelayMs: intFromEnv('REQUEST_DELAY_MS', 1500, { min: 0 }),
  };
}

export { loadConfig, getApiConfig, env };
