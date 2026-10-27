const { HttpError } = require('../local-ai/domain.cjs');
const { RETENTION_MS, validate, versionOf } = require('./domain.cjs');

function createService({ collection, core, reader, uid, now = () => new Date() }) {
  async function messageFor(id) {
    await reader.authorize();
    const message = (await core.Messages.findVisibleByIds([id]).toArray())[0];
    const version = versionOf(message);
    await reader.room(message.rid);
    return { message, version };
  }
  async function inspect(input, offset = 0) {
    validate(input);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'Некорректная страница.');
    const { message, version } = await messageFor(input.messageId);
    const filter = { messageId: message._id, version, expiresAt: { $gt: now() } };
    const author = message.u._id === uid;
    const own = await collection.findOne({ ...filter, userId: uid });
    const result = { success: true, messageId: message._id, version, text: message.msg, author, confirmedAt: own?.at || null, retentionDays: 90 };
    if (!author) return result;
    const rows = await collection.find(filter, { projection: { _id: 0, userId: 1, at: 1 } }).sort({ at: 1, userId: 1 }).skip(offset).limit(51).toArray();
    result.readers = await Promise.all(rows.slice(0, 50).map(async row => {
      const user = await core.Users.findOneById(row.userId, { projection: { username: 1, name: 1 } });
      return { userId: row.userId, username: user?.username || null, name: user?.name || user?.username || 'Удалённая учётная запись', at: row.at };
    }));
    result.nextOffset = rows.length > 50 ? offset + 50 : null;
    return result;
  }
  async function acknowledge(input) {
    validate(input, true);
    const { message, version } = await messageFor(input.messageId);
    if (message.u._id === uid) throw new HttpError(403, 'Автор не подтверждает просмотр собственного сообщения.');
    if (version !== input.version) throw new HttpError(409, 'Сообщение изменено. Откройте его заново.');
    const at = now();
    const filter = { messageId: message._id, version, userId: uid };
    // Expired records cannot be reused while MongoDB's TTL cleanup is pending.
    await collection.deleteOne({ ...filter, expiresAt: { $lte: at } });
    try {
      await collection.updateOne(filter, { $setOnInsert: { ...filter, at, expiresAt: new Date(at.getTime() + RETENTION_MS) } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
    const record = await collection.findOne(filter);
    return { success: true, confirmedAt: record.at, version };
  }
  return { inspect, acknowledge };
}
module.exports = { createService };
