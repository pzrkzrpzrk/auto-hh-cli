// Простой логгер с уровнями и записью в файл.
import fs from "fs";
import { LOG_FILE, ensureDir } from "./paths.js";

function write(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', msg: string, meta?: any) {
  ensureDir();
  const ts = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false }).replace(',', '');
  const line = `[${ts}] [${level}] ${msg}` +
    (meta ? ' ' + JSON.stringify(meta) : '');
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

const info = (m, meta?) => write('INFO', m, meta);
const warn = (m, meta?) => write('WARN', m, meta);
const error = (m, meta?) => write('ERROR', m, meta);
const debug = (m, meta?) => process.env.DEBUG && write('DEBUG', m, meta);

export default { info, warn, error, debug };
