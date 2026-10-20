// Стратегия паузы между откликами: сценарию важно «подожди», а не как именно.
// Боевой режим — случайная пауза из env; в проверках подставляется Null Object без ожидания.
import { rand, sleep } from "@/shared/time.js";
import type { ApplySettings } from "@/application/apply/ApplyDeps.js";

export interface Pacing {
  pause(): Promise<void>;
}

/** Случайная пауза [min, max] — прежний sleep(rand(MIN_DELAY, MAX_DELAY)) после отклика. */
export class RandomPacing implements Pacing {
  private readonly minMs: number;
  private readonly maxMs: number;

  constructor(settings: ApplySettings) {
    this.minMs = settings.minDelayMs;
    this.maxMs = settings.maxDelayMs;
  }

  pause(): Promise<void> {
    return sleep(rand(this.minMs, this.maxMs));
  }
}

/** Null Object: паузы нет — для проверок и сухого прогона на фейковых портах. */
export class NoPacing implements Pacing {
  pause(): Promise<void> {
    return Promise.resolve();
  }
}
