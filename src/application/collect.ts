// Утилиты собранной выдачи: плоский список вакансий и формат зарплаты.
// Сам сбор (страницы, карточки, кэш) — в application/search/VacancyCollector.ts;
// здесь только чистые функции, которыми пользуются digest, cover и печать.
// fmtSalary переехал в shared/format.ts (им пользуется и домен), здесь — реэкспорт
// для существующих импортов.
import { fmtSalary } from "../shared/format.js";

// Плоский список собранных вакансий без дублей — вход для шага digest.
function flattenCollected(cache): any[] {
  const byId = new Map<string, any>();
  for (const page of Object.keys(cache.pages || {})) {
    for (const item of cache.pages[page] || []) {
      const id = String(item.id);
      if (!byId.has(id)) byId.set(id, item);
    }
  }
  return [...byId.values()];
}

export { flattenCollected, fmtSalary };

