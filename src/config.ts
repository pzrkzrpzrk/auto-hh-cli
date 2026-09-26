// Загрузка конфигурации из JSON и .env.
import fs from "fs";
import path from "path";

function loadConfig() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  const absPath = path.resolve(configPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Config not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  return JSON.parse(raw);
}

function env() {
  return {
    userAgent: process.env.HH_USER_AGENT || 'AutoHH/1.0',
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '1500', 10),
  };
}

export { loadConfig, env };
