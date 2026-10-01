// Конфиг migrate-mongo для auto-hh-cli.
// Параметры подключения берём из .env, чтобы миграции работали с той же базой,
// что и приложение (src/clients/db.ts). Сам migrate-mongo .env не читает —
// поэтому подгружаем его здесь.
require('dotenv').config();

// Дефолты совпадают с src/clients/db.ts (MONGODB_URI / MONGODB_TIMEOUT_MS).
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/autohh';
const TIMEOUT_MS = parseInt(process.env.MONGODB_TIMEOUT_MS || '10000', 10);

// Имя базы берём из URI: mongodb://host:порт/имя (работает и для mongodb+srv,
// и для списка хостов). Если базы в URI нет — оставляем undefined: драйвер
// выберет её так же, как приложение, вызывающее MongoClient.db() без аргументов.
function databaseNameFromUri(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]*\/([^/?]+)/.exec(uri);
  return match ? decodeURIComponent(match[1]) : undefined;
}

module.exports = {
  mongodb: {
    url: URI,
    databaseName: databaseNameFromUri(URI),
    // Не ждём дефолтные 30 с, если MongoDB недоступна.
    options: { serverSelectionTimeoutMS: TIMEOUT_MS },
  },

  // Каталог миграций. Файлы в нём — CommonJS (module.exports), как и весь проект.
  migrationsDir: 'migrations',

  // Коллекция с историей применённых миграций.
  changelogCollectionName: 'changelog',

  // Коллекция-замок: защищает от одновременного запуска миграций (Ttl 0 — без автоочистки).
  lockCollectionName: 'changelog_lock',
  lockTtl: 0,

  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};
