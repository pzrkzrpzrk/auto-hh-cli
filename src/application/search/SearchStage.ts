// Стадия конвейера поиска (Template Method): общий каркас «включена → выполнить → ошибка»,
// подкласс описывает только свою фазу и политику ошибки.
import type { SearchContext } from "./SearchContext.js";

export type StageResult = 'continue' | 'stop';

export abstract class SearchStage {
  abstract readonly name: string;

  async run(ctx: SearchContext): Promise<StageResult> {
    if (!this.enabled(ctx)) return 'continue';
    try {
      return await this.execute(ctx);
    } catch (err: any) {
      return this.onError(err, ctx);
    }
  }

  /** Нужна ли стадия в этом прогоне (например, нет вакансий — нечего сохранять). */
  protected enabled(_ctx: SearchContext): boolean {
    return true;
  }

  protected abstract execute(ctx: SearchContext): Promise<StageResult>;

  /** По умолчанию ошибка фазы валит сценарий (как раньше для страниц выдачи). */
  protected onError(err: any, _ctx: SearchContext): StageResult {
    throw err;
  }
}
