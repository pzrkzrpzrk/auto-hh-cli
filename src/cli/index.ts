// CLI entry point: регистрирует команды и запускает Commander.
// CLI entry point: единственная точка входа — интерактивное меню.
// Все шаги (поиск, дайджест, письма, отклики, планировщик, резюме) меню вызывает
// напрямую из cmd-*, поэтому отдельных подкоманд у CLI больше нет.
import {  Command  } from "commander";
import cmdUi from "./cmd-ui.js";
import { close as closeDb } from "../clients/db";

const program = new Command();

program
  .name('auto-hh')
  .usage('[options]')
  .description('CLI для поиска, фильтрации и отклика на вакансии hh.ru')
  .version(require('../../package.json').version);

// Меню — единственная точка входа CLI: остальные шаги доступны только из него.
program
  .command('ui')
  .aliases(['menu', 'interactive'])
  .description('Интерактивное меню: поиск, дайджест, письма, отклики, планировщик, резюме')
  .action(cmdUi);

// Запуск без аргументов тоже открывает меню — подкоманд у CLI больше нет.
program.argument('[command]', 'не поддерживается: все шаги делаются в меню');
program.action((command?: string) => {
  // Подкоманд нет, поэтому любой аргумент здесь — попытка вызвать старую команду.
  if (command) {
    console.error(`Команд больше нет: «${command}» — все шаги делаются в интерактивном меню.`);
    console.error('Запустите: npm start   (или: auto-hh)');
    process.exitCode = 1;
    return;
  }
  return cmdUi();
});

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
