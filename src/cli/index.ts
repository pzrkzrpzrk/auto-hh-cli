// CLI entry point: регистрирует команды и запускает Commander.
import {  Command  } from "commander";
import cmdSearch from "./cmd-search.js";
import cmdApply from "./cmd-apply.js";
import cmdDigest from "./cmd-digest.js";
import cmdHistory from "./cmd-history.js";
import cmdConfig from "./cmd-config.js";
import cmdReset from "./cmd-reset.js";
import cmdCover from "./cmd-cover.js";
import cmdSchedule from "./cmd-schedule.js";
import cmdGradeResume from "./cmd-grade-resume.js";
import cmdResume from "./cmd-resume.js";
import cmdUi from "./cmd-ui.js";
import { close as closeDb } from "../clients/db";

const program = new Command();

program
  .name('auto-hh')
  .description('CLI для поиска, фильтрации и отклика на вакансии hh.ru')
  .version(require('../../package.json').version);

program
  .command('search')
  .description('Поиск вакансий на hh.ru → кэш (без фильтра, ИИ и писем)')
  .option('-c, --config <path>', 'Путь к config.json')
  .option('--reset', 'Сбросить историю и кэш перед поиском')
  .action(cmdSearch);

program
  .command('apply')
  .description('Откликнуться через Playwright на вакансии из дайджеста')
  .option('-l, --limit <n>', 'Сколько вакансий обработать', parseInt)
  .option('-t, --type <type>', 'latest (сегодня) или all (все дни)', 'latest')
  .option('--login', 'Режим логина (открыть браузер для входа на hh.ru)')
  .action(cmdApply);

program
  .command('digest')
  .description('Собрать дайджест из кэша поиска (фильтр + ИИ-судья) или показать последний: digest show')
  .argument('[action]', 'build (по умолчанию) или show', 'build')
  .option('-c, --config <path>', 'Путь к config.json')
  .option('-r, --resume <name>', 'Имя резюме из RESUMES_DIR')
  .option('-l, --limit <n>', 'Максимум вакансий в дайджесте', parseInt)
  .option('-d, --dry-run', 'Только отбор, без записи файлов и MongoDB')
  .option('--no-claude', 'Без ИИ — только локальный фильтр')
  .option('-j, --json', 'Для show: вывод в JSON')
  .action((action, opts) => cmdDigest(action, opts));

program
  .command('history')
  .description('Показать историю откликов')
  .option('-j, --json', 'Вывод в JSON')
  .action(cmdHistory);

program
  .command('config')
  .description('Показать текущую конфигурацию')
  .action(cmdConfig);

program
  .command('reset')
  .description('Сбросить историю, кэш и дайджесты')
  .action(cmdReset);

program
  .command('cover')
  .description('Сопроводительные письма: без id — для всего последнего дайджеста, с id — для одной вакансии')
  .argument('[vacancyId]', 'ID вакансии (без него — весь последний дайджест)')
  .option('-r, --resume <name>', 'Имя резюме из RESUMES_DIR')
  .option('-l, --limit <n>', 'Сколько вакансий обработать', parseInt)
  .option('-f, --force', 'Перегенерировать письма, даже если они уже есть')
  .action((vacancyId, opts) => cmdCover(vacancyId, opts));

program
  .command('schedule')
  .description('Запустить планировщик — шаги из config.schedule.steps по cron')
  .action(cmdSchedule);

program
  .command('grade')
  .description('Оценить резюме через AI')
  .option('-r, --resume <name>', 'Имя резюме из RESUMES_DIR')
  .action(cmdGradeResume);

program
  .command('resume')
  .description('Управление резюме: list / register <name> / show [name]')
  .argument('[subcommand]', 'list, register или show')
  .argument('[name]', 'Имя резюме (для register/show)')
  .action((subcommand, name) => cmdResume({ _: [subcommand, name].filter(Boolean) }));

program
  .command('ui')
  .aliases(['menu', 'interactive'])
  .description('Интерактивное меню для работы со всеми командами')
  .action(cmdUi);

// Точка входа CLI: parseAsync + гарантированное закрытие MongoDB.
// Без этого монитор соединения держит event loop и процесс не завершается после команды.
export async function run(argv: string[] = process.argv): Promise<void> {
  try {
    await program.parseAsync(argv);
  } catch (err: any) {
    console.error(`Ошибка: ${err?.message || err}`);
    process.exitCode = 1;
  } finally {
    await closeDb().catch(() => {});
  }
}

export default program;
