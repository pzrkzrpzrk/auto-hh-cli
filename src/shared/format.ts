// Форматирование значений для логов, .md-файлов и консоли.
// Вынесено в shared: формат зарплаты нужен и домену (записи digest/rejected),
// и presentation (отчёты поиска), поэтому application/collect.ts его реэкспортирует.

/** Зарплата в человекочитаемом виде: «от 100 до 200 RUR»; пусто — «—». */
export function fmtSalary(salary: any): string {
  if (!salary) return '—';
  const parts: string[] = [];
  if (salary.from) parts.push(`от ${salary.from}`);
  if (salary.to) parts.push(`до ${salary.to}`);
  return `${parts.join(' ') || '?'} ${salary.currency || ''}`.trim();
}
