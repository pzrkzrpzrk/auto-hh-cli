// Параметры прогона, которые приходят из CLI и меню: один контракт на все команды.
// Раньше каждый фасад объявлял Record<string, any> — опечатка в имени флага проходила
// молча и «теряла» опцию. Здесь перечислены реальные флаги команд, а индексная
// сигнатура оставляет совместимость с commander (лишние ключи не ломают прогон).
export interface CommandOptions {
  /** Путь к config.json: явный флаг важнее CONFIG_PATH. */
  config?: string;
  /** Имя или файл резюме: определяет папку артефактов и запись в БД. */
  resume?: string;
  [key: string]: unknown;
}

/** Поиск: сброс данных перед проходом (папка резюме + общий кэш). */
export interface SearchOptions extends CommandOptions {
  reset?: boolean;
}

/** Показ дайджеста: машинный вывод для скриптов. */
export interface ShowOptions extends CommandOptions {
  json?: boolean;
}

/** Актуализация дайджестов и rejected: посчитать без записи файлов. */
export interface ActualizeOptions extends CommandOptions {
  dryRun?: boolean;
}

/** Письма: лимит вакансий и перегенерация уже готовых. */
export interface CoverOptions extends CommandOptions {
  limit?: number;
  force?: boolean;
}

/** Отклик: ручной вход в браузер, стратегия выбора и лимит. */
export interface ApplyOptions extends CommandOptions {
  login?: boolean;
  type?: string;
  limit?: number;
}

/** Планировщик: шагам передаются только config и resume. */
export type ScheduleOptions = CommandOptions;
