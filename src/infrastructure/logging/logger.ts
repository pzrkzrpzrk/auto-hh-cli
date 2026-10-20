// Файловый логгер — адаптер порта LogSink: единственное место с fs и LOG_FILE.
// Импортируется composition root, который регистрирует sink в shared/logger.
import fs from "fs";
import { LOG_FILE, ensureDir } from "@/infrastructure/config/paths.js";
import { setLogSink } from "@/shared/logger.js";
import type { LogSink } from "@/shared/logging.js";

function write(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', msg: string, meta?: unknown) {
  ensureDir();
  const ts = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false }).replace(',', '');
  const line = `[${ts}] [${level}] ${msg}` + (meta ? ' ' + JSON.stringify(meta) : '');
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

const fileLogSink: LogSink = {
  info: (m, meta) => write('INFO', m, meta),
  warn: (m, meta) => write('WARN', m, meta),
  error: (m, meta) => write('ERROR', m, meta),
  debug: (m, meta) => {
    if (process.env.DEBUG) write('DEBUG', m, meta);
  },
};

setLogSink(fileLogSink);

export default fileLogSink;
