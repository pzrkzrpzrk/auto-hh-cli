export function stripHtml(s: string): string {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseJSON(text: string): any {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.replace(/^\*\*+/, '').replace(/\*\*+$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Модель иногда добавляет пояснения вокруг JSON — берём фрагмент между
    // первой { и последней }. На валидном JSON поведение не меняется.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw err;
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}
