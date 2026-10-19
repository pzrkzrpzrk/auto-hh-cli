// Стадия конвейера (Template Method): общий каркас запуска, шаг — в execute().
// Проверка «конвейер уже остановлен» живёт здесь, поэтому каждая стадия не дублирует её.
import type { DigestContext } from "./DigestContext.js";

export type StageOutcome = 'continue' | 'stop';

export abstract class DigestStage {
  /** Имя для диагностики и тестов. */
  abstract readonly name: string;

  async run(ctx: DigestContext): Promise<StageOutcome> {
    if (ctx.outcome !== 'ok') return 'stop';
    return this.execute(ctx);
  }

  protected abstract execute(ctx: DigestContext): Promise<StageOutcome>;
}
