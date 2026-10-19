// Утилиты собранной выдачи: плоский список вакансий и формат зарплаты.
// Сам сбор (страницы, карточки, кэш) — в application/search/VacancyCollector.ts;
// здесь только чистые функции, которыми пользуются digest, cover и печать.

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

function fmtSalary(s) {
  if (!s) return '—';
  const parts = [];
  if (s.from) parts.push(`от ${s.from}`);
  if (s.to) parts.push(`до ${s.to}`);
  return `${parts.join(' ') || '?'} ${s.currency || ''}`.trim();
}

export { flattenCollected, fmtSalary };
