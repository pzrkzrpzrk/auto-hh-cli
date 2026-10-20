// Стратегия режима писем: одна вакансия или весь последний дайджест.
// Заменяет ветку `id ? coverOne(...) : coverDigest(...)` в сценарии: у каждого режима
// свой класс, а новый режим (например, письма по дате) добавляется ещё одной реализацией.
import type { CoverOutcome } from "@/application/cover/CoverDeps.js";

export interface CoverMode {
  run(): Promise<CoverOutcome>;
}
