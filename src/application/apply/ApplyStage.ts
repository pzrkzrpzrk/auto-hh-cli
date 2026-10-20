// Стадия конвейера отклика (Template Method): общий каркас «включена → выполнить → ошибка».
// Подкласс описывает только свою фазу плана и политику ошибки.
import type { ApplyContext } from "@/application/apply/ApplyContext.js";

export type StageResult = 'continue' | 'stop';

export abstract class ApplyStage {
  /** Имя для диагностики и тестов. */
  abstract readonly name: string;

  async run(ctx: ApplyContext): Promise<StageResult> {
    if (!this.enabled(ctx)) return 'continue';
    try {
      return await this.execute(ctx);
    } catch (err: any) {
      return this.onError(err, ctx);
    }
  }

  /** Нужна ли стадия в этом прогоне (например, нет вакансий — нечего ограничивать). */
  protected enabled(_ctx: ApplyContext): boolean {
    return true;
  }

  protected abstract execute(ctx: ApplyContext): Promise<StageResult>;

  /** По умолчанию ошибка фазы валит сценарий: без плана откликаться нельзя. */
  protected onError(err: any, _ctx: ApplyContext): StageResult {
    throw err;
  }
}
