// Стадия конвейера писем (Template Method): общий каркас «включена → выполнить → ошибка».
// Подкласс описывает только свою фазу плана и политику ошибки.
import type { CoverContext } from "@/application/cover/CoverContext.js";

export type StageResult = 'continue' | 'stop';

export abstract class CoverStage {
  /** Имя для диагностики и тестов. */
  abstract readonly name: string;

  async run(ctx: CoverContext): Promise<StageResult> {
    if (!this.enabled(ctx)) return 'continue';
    try {
      return await this.execute(ctx);
    } catch (err: any) {
      return this.onError(err, ctx);
    }
  }

  /** Нужна ли стадия в этом прогоне (например, нет вакансий без письма). */
  protected enabled(_ctx: CoverContext): boolean {
    return true;
  }

  protected abstract execute(ctx: CoverContext): Promise<StageResult>;

  /** По умолчанию ошибка фазы валит сценарий: молча терять письма нельзя. */
  protected onError(err: any, _ctx: CoverContext): StageResult {
    throw err;
  }
}
