// Тип логгера для shared/domain: без fs, env и инфраструктуры.
// Реализацию подставляет composition root (infrastructure/logging/logger.ts).
export interface LogSink {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
}
