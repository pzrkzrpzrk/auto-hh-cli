// Добавляет поле publishedAt в каждую запись entries дайджеста (появилось в 2026-09).
// Старые записи хранились без publishedAt, бэкфилл невозможен (cacheFull дату публикации
// не хранил), поэтому ставим null. $mergeObjects не затирает уже существующий publishedAt.
module.exports = {
  async up(db) {
    const result = await db.collection('digest').updateMany(
      {},
      [{ $set: { entries: {
        $map: {
          input: '$entries',
          as: 'e',
          in: { $mergeObjects: [{ publishedAt: null }, '$$e'] },
        },
      } } }],
    );
    console.log(`Digest updated: ${result.modifiedCount} docs`);
  },

  async down(db) {
    const result = await db.collection('digest').updateMany(
      {},
      [{ $set: { entries: {
        $map: {
          input: '$entries',
          as: 'e',
          in: { $unsetField: { field: 'publishedAt', input: '$$e' } },
        },
      } } }],
    );
    console.log(`Digest reverted: ${result.modifiedCount} docs`);
  },
};
