// Загрузка конфигурации из JSON и .env.
import fs from "fs";
import path from "path";

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

function loadConfig() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  const absPath = path.resolve(configPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Config not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  const cfg = JSON.parse(raw);

  // Личный блэклист компаний держим в .env, чтобы он не попадал в git.
  const excludedCompanies = excludedCompaniesFromEnv();
  if (excludedCompanies) {
    cfg.filter = { ...(cfg.filter || {}), excludedCompanies };
  }

  return cfg;
}

function env() {
  return {
    clientId: process.env.HH_CLIENT_ID,
    clientSecret: process.env.HH_CLIENT_SECRET,
    redirectUri: process.env.HH_REDIRECT_URI || 'http://localhost:3000/callback',
    accessToken: process.env.HH_ACCESS_TOKEN,
    refreshToken: process.env.HH_REFRESH_TOKEN,
    userAgent: process.env.HH_USER_AGENT || 'AutoHH/1.0',
    resumeId: process.env.HH_RESUME_ID,
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '1500', 10),
  };
}

export { loadConfig, env };
