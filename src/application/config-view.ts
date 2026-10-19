// Сценарий «покажи конфиг»: presentation не читает infrastructure напрямую.
import type { ConfigProvider } from "../domain/ports.js";

export interface ConfigViewDeps {
  config: ConfigProvider;
}

/** Текущая конфигурация с учётом явного `--config` (если задан). */
export function showConfig(deps: ConfigViewDeps, opts: { config?: string } = {}) {
  return deps.config.load(opts.config);
}
