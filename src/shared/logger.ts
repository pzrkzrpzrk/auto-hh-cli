// Простой логгер с уровнями. Реализация записи (файл, env DEBUG) — в infrastructure,
// чтобы shared не зависел от fs и config/paths. До регистрации sink пишет в консоль.
import type { LogSink } from "@/shared/logging.js";

function line(level: string, msg: string, meta?: unknown): string {
  const ts = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false }).replace(',', '');
  return `[${ts}] [${level}] ${msg}` + (meta ? ' ' + JSON.stringify(meta) : '');
}

const consoleSink: LogSink = {
  info: (m, meta) => console.log(line('INFO', m, meta)),
  warn: (m, meta) => console.log(line('WARN', m, meta)),
  error: (m, meta) => console.log(line('ERROR', m, meta)),
  debug: () => {},
};

let sink: LogSink = consoleSink;

/** Установить реализацию логирования (composition root вызывает один раз). */
export function setLogSink(next: LogSink): void {
  sink = next;
}

const log: LogSink = {
  info: (m, meta) => sink.info(m, meta),
  warn: (m, meta) => sink.warn(m, meta),
  error: (m, meta) => sink.error(m, meta),
  debug: (m, meta) => sink.debug(m, meta),
};

export default log;
export type { LogSink } from "@/shared/logging.js";
