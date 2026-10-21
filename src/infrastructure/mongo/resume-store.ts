// MongoDB-хранилище для коллекции resumes: каталог резюме с отпечатком содержимого.
import { connect, dbInstance } from "@/infrastructure/mongo/db.js";
import { resumeContentHash } from "@/shared/hash.js";
import type { Resume } from "@/domain/models.js";

export interface ResumeDoc {
  resumeId: string;
  name: string;
  filename: string;
  /** sha256 содержимого (текст либо base64 PDF); у legacy-документов отсутствует. */
  contentHash?: string;
  createdAt: Date;
  /** Когда содержимое/имя файла менялись в последний раз. */
  updatedAt?: Date;
}

export async function listResumes(): Promise<ResumeDoc[]> {
  await connect();
  return dbInstance().collection<ResumeDoc>('resumes')
    .find({}, { sort: { createdAt: -1 } })
    .toArray();
}

export async function findResume(resumeId: string): Promise<ResumeDoc | null> {
  await connect();
  return dbInstance().collection<ResumeDoc>('resumes').findOne({ resumeId });
}

/**
 * Регистрация резюме: обновляет имя/файл/отпечаток, createdAt ставит только при вставке.
 * changed=true — содержимое изменилось с прошлой регистрации (вердикты/письма устарели).
 */
export async function registerResume(resume: Resume): Promise<{ created: boolean; changed: boolean }> {
  await connect();
  const coll = dbInstance().collection<ResumeDoc>('resumes');
  const contentHash = resumeContentHash(resume);
  const existing = await coll.findOne({ resumeId: resume.id });
  const now = new Date();
  await coll.updateOne(
    { resumeId: resume.id },
    {
      $set: { name: resume.name, filename: resume.filename, contentHash, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  return {
    created: !existing,
    // Legacy-документ без хеша не считается «изменённым»: просто дозаполняем отпечаток.
    changed: Boolean(existing?.contentHash && existing.contentHash !== contentHash),
  };
}
