// Команда search: тонкая оболочка — печать фаз поиска (сценарий в application/search.ts).
// Отбор + ИИ-судья — отдельный шаг `digest`, сопроводительные — отдельный шаг `cover`.
import { collectDeps } from "../../../composition.js";
import { runSearch, type SearchEvent } from "../../../application/search.js";
import { fmtSalary } from "../../../application/collect.js";

const PREVIEW_LIMIT = 20;

function printEvent(e: SearchEvent) {
  switch (e.type) {
    case 'reset':
      console.log(e.text ? `Сброшено перед поиском: ${e.text}` : 'Сброшено: данные уже были пусты.');
      return;
    case 'found': {
      console.log(`\n=== НАЙДЕНО: ${e.items.length} ===`);
      for (const item of e.items.slice(0, PREVIEW_LIMIT)) {
        console.log(`- ${item.name} @ ${item.employer?.name || '—'} | ${fmtSalary(item.salary)}`);
        console.log(`  ${item.alternate_url}`);
      }
      if (e.items.length > PREVIEW_LIMIT) {
        console.log(`... и ещё ${e.items.length - PREVIEW_LIMIT}`);
      }
      return;
    }
    case 'nothing-found':
      console.log('\nНичего не найдено — проверьте config.search.');
      return;
    case 'files-saved':
      console.log(`\nВыдача сохранена по регионам: ${e.results.length}, +${e.added} новых, всего ${e.total}`);
      for (const r of e.results) if (r.added > 0) console.log(`  • ${r.file} (+${r.added})`);
      return;
    case 'files-unchanged':
      console.log(`\nНовых вакансий нет — файлы не изменились (${e.results.length} регион(ов), всего ${e.total})`);
      return;
    case 'files-failed':
      console.error(`⚠️  Выдачу не удалось сохранить в файл: ${e.message}`);
      return;
    case 'full-cards': {
      const { summary } = e;
      const parts = [`+${summary.saved}`];
      if (summary.cached) parts.push(`уже в кэше ${summary.cached}`);
      if (summary.skippedSeen) parts.push(`просмотренных пропущено ${summary.skippedSeen}`);
      if (summary.failed) parts.push(`ошибок ${summary.failed}`);
      console.log(`\nПолные карточки (cacheFull): ${parts.join(', ')} из ${summary.candidates} найденных`);
      if (!summary.saved && !summary.failed) {
        console.log('Все карточки уже в кэше — за описаниями на hh.ru не ходили.');
      } else if (summary.failed) {
        console.log('Недостающие описания digest и cover догрузят сами.');
      }
      return;
    }
    case 'full-cards-failed':
      console.error(`⚠️  Полные карточки не собрались: ${e.message}`);
      console.error('Страницы выдачи в кэше — digest и cover догрузят описания сами.');
      return;
    case 'done':
      console.log('\nДальше: пункт меню «🧠 Собрать дайджест» — локальный фильтр + ИИ-судья');
      return;
    case 'search-failed-after-reset':
      console.error('\nПоиск не выполнился, но история, кэш и дайджесты уже сброшены.');
      console.error('Повторите: пункт меню «🔍 Поиск вакансий»');
      return;
    default:
      return;
  }
}

export default async function search(opts: Record<string, any> = {}) {
  await runSearch(opts, collectDeps, printEvent);
}
