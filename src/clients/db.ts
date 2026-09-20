// MongoDB connection manager.
import { MongoClient, Db } from "mongodb";

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/autohh';
// Не ждём дефолтные 30 с, если MongoDB недоступна: команды (digest show, cover, apply)
// должны деградировать быстро и понятно.
const TIMEOUT_MS = parseInt(process.env.MONGODB_TIMEOUT_MS || '10000', 10);

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connect(): Promise<Db> {
  if (db) return db;
  // Неудачное подключение не должно оставлять за собой живые хендлы:
  // иначе Node не завершится, даже если команда уже напечатала результат.
  const c = new MongoClient(URI, { serverSelectionTimeoutMS: TIMEOUT_MS });
  try {
    await c.connect();
  } catch (err) {
    await c.close().catch(() => {});
    throw err;
  }
  client = c;
  db = c.db();
  return db;
}

export function dbInstance(): Db {
  if (!db) throw new Error('MongoDB not connected. Call connect() first.');
  return db;
}

export async function close(): Promise<void> {
  if (client) await client.close();
  client = null;
  db = null;
}
