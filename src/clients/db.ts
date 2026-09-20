// MongoDB connection manager.
import { MongoClient, Db } from "mongodb";

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/autohh';
// Не ждём дефолтные 30 с, если MongoDB недоступна: команды (digest show, cover, apply)
// должны деградировать быстро и понятно.
const TIMEOUT_MS = parseInt(process.env.MONGODB_TIMEOUT_MS || '10000', 10);

let client: MongoClient | null = null;
let db: Db | null = null;
// Незавершённое подключение: параллельные connect() не должны создавать второй клиент
// (иначе «осиротевшие» клиенты держат event loop и процесс не завершается).
let connecting: Promise<Db> | null = null;
// Все созданные клиенты — страховка для close(): закрываем всё, что открыли.
const opened = new Set<MongoClient>();

export async function connect(): Promise<Db> {
  if (db) return db;
  if (!connecting) {
    connecting = (async () => {
      // Неудачное подключение не должно оставлять за собой живые хендлы:
      // иначе Node не завершится, даже если команда уже напечатала результат.
      const c = new MongoClient(URI, { serverSelectionTimeoutMS: TIMEOUT_MS });
      opened.add(c);
      try {
        await c.connect();
      } catch (err) {
        opened.delete(c);
        await c.close().catch(() => {});
        throw err;
      }
      client = c;
      db = c.db();
      return db;
    })();
    // После неудачи разрешаем следующую попытку, иначе connecting «залипнет» навсегда.
    connecting.catch(() => { connecting = null; });
  }
  return connecting;
}

export function dbInstance(): Db {
  if (!db) throw new Error('MongoDB not connected. Call connect() first.');
  return db;
}

export async function close(): Promise<void> {
  const clients = [...opened];
  opened.clear();
  client = null;
  db = null;
  connecting = null;
  await Promise.all(clients.map(c => c.close().catch(() => {})));
}
