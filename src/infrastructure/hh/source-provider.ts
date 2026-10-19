// Провайдер жизненного цикла источника (Factory + RAII):
// создать адаптер → отдать сценарию → закрыть браузер в finally, даже при исключении.
import HHClient from "./client.js";
import type { SourceProvider } from "../../domain/ports.js";

class HHSourceProvider<T extends { close(): Promise<void> }> implements SourceProvider<T> {
  constructor(private readonly create: (client: HHClient) => T) {}

  async withSource<R>(fn: (source: T) => Promise<R>): Promise<R> {
    const source = this.create(new HHClient());
    try {
      return await fn(source);
    } finally {
      await source.close();
    }
  }
}

export default HHSourceProvider;
