// Резюме как измерение данных: документы digest/rejected получают resumeId,
// кэш писем — тот же ключ (resumeId + vacancyId), старые данные привязываются,
// если в реестре ровно одно резюме (иначе привязка была бы догадкой).
module.exports = {
  async up(db) {
    // Уникальность «дата + резюме»: два резюме за один день больше не перезаписывают друг друга.
    await db.collection('digest').createIndex({ date: 1, resumeId: 1 }, { unique: true }).catch(() => {});
    await db.collection('rejected').createIndex({ date: 1, resumeId: 1 }, { unique: true }).catch(() => {});

    // Индексы кэшей уже созданы миграцией 20260530; повторяем идемпотентно на случай ручной базы.
    await db.collection('cacheJudgements')
      .createIndex({ date: 1, resumeId: 1, vacancyId: 1 }, { unique: true }).catch(() => {});
    await db.collection('cacheCoverLetters')
      .createIndex({ resumeId: 1, vacancyId: 1 }, { unique: true }).catch(() => {});

    const resumes = await db.collection('resumes')
      .find({}, { projection: { resumeId: 1, name: 1, filename: 1 } })
      .toArray();
    if (resumes.length !== 1) {
      console.log(`Resume backfill skipped: ${resumes.length} resumes in registry (need exactly 1)`);
      return;
    }

    const resume = resumes[0];
    const resumeId = resume.resumeId;
    const resumeName = String(resume.name || '').trim() || resumeId;

    for (const collection of ['digest', 'rejected']) {
      const docs = await db.collection(collection)
        .find({ $or: [{ resumeId: { $exists: false } }, { resumeId: null }] })
        .toArray();
      let updated = 0;
      for (const doc of docs) {
        try {
          await db.collection(collection).updateOne(
            { _id: doc._id },
            { $set: { resumeId, resumeName } },
          );
          updated++;
        } catch (err) {
          // Конфликт уникального индекса: документ под это резюме уже есть — оставляем legacy как есть.
        }
      }
      if (updated) console.log(`${collection}: ${updated} docs bound to ${resumeName}`);
    }

    for (const collection of ['cacheJudgements', 'cacheCoverLetters']) {
      const docs = await db.collection(collection)
        .find({ $or: [{ resumeId: { $exists: false } }, { resumeId: null }] })
        .toArray();
      let updated = 0;
      for (const doc of docs) {
        try {
          await db.collection(collection).updateOne({ _id: doc._id }, { $set: { resumeId } });
          updated++;
        } catch (err) {
          // Дубликат «резюме + вакансия» — более точная запись уже существует.
        }
      }
      if (updated) console.log(`${collection}: ${updated} docs bound to ${resumeName}`);
    }
  },

  // Откат не удаляет привязку: без неё уже сгенерированные письма/вердикты
  // смешались бы между резюме. Убираем только добавленные индексы.
  async down(db) {
    await db.collection('digest').dropIndex('date_1_resumeId_1').catch(() => {});
    await db.collection('rejected').dropIndex('date_1_resumeId_1').catch(() => {});
  },
};
