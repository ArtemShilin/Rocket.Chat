const { randomUUID } = require('node:crypto');
const { HttpError } = require('../local-ai/domain.cjs');
const { exact, validId, createInput, voteInput, isClosed, resultsVisible } = require('./domain.cjs');

function createService({ polls, ballots, client, core, reader, uid, admin, publish, now = () => new Date() }) {
  async function access(id, session) {
    if (!validId(id)) throw new HttpError(400, 'Некорректный опрос.');
    const poll = await polls.findOne({ _id: id }, { session });
    if (!poll) throw new HttpError(404, 'Опрос не найден.');
    await reader.room(poll.roomId);
    const message = (await core.Messages.findVisibleByIds([poll.messageId]).toArray())[0];
    if (!message && poll.status === 'publishing') throw new HttpError(425, 'Опрос публикуется…');
    if (!message || message.rid !== poll.roomId || message.u?._id !== poll.creatorId || !message.msg?.includes('/polls/' + id)) throw new HttpError(404, 'Сообщение с опросом удалено или изменено.');
    if (poll.status === 'publishing') {
      await polls.updateOne({ _id: id, status: 'publishing' }, { $set: { status: 'open' } }, { session });
      poll.status = 'open';
    }
    return poll;
  }
  async function transaction(operation) {
    const session = client.startSession();
    try { return await session.withTransaction(() => operation(session), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000 }); }
    finally { await session.endSession(); }
  }
  async function get(id) {
    const poll = await access(id);
    const [stats] = await ballots.aggregate([
      { $match: { pollId: id } },
      { $facet: {
        total: [{ $count: 'n' }],
        options: [{ $unwind: '$selections' }, { $group: { _id: '$selections', n: { $sum: 1 } } }],
        own: [{ $match: { userId: uid } }, { $project: { selections: 1 } }],
      } },
    ]).toArray();
    const own = stats?.own[0]?.selections || []; const visible = resultsVisible(poll, own, now());
    const creator = await core.Users.findOneById(poll.creatorId, { projection: { name: 1, username: 1 } });
    const total = stats?.total[0]?.n || 0;
    return {
      id: poll._id, messageId: poll.messageId, roomId: poll.roomId, question: poll.question, description: poll.description,
      multiple: poll.multiple, maxSelections: poll.maxSelections, anonymous: poll.anonymous, results: poll.results,
      closesAt: poll.closesAt, closed: isClosed(poll, now()), createdAt: poll.createdAt,
      creator: creator?.name || creator?.username || 'Участник', canManage: poll.creatorId === uid || admin,
      own, total, resultsVisible: visible,
      options: poll.options.map(option => ({ ...option, count: visible ? stats?.options.find(row => row._id === option.id)?.n || 0 : null })),
    };
  }
  async function create(body) {
    const input = createInput(body, now()); await reader.room(input.roomId);
    const id = randomUUID();
    await polls.insertOne({ _id: id, ...input, messageId: 'np_' + id, creatorId: uid, status: 'publishing', createdAt: now(), revision: 0 });
    let message;
    try { message = await publish(id, input); if (!message?._id) throw new HttpError(409, 'Публикация отменена правилами комнаты.'); }
    catch (error) { await polls.deleteOne({ _id: id, status: 'publishing' }); throw error; }
    await polls.updateOne({ _id: id, status: 'publishing' }, { $set: { status: 'open', messageId: message._id } });
    return get(id);
  }
  async function vote(body) {
    exact(body, ['pollId', 'selections']);
    await transaction(async session => {
      const poll = await access(body.pollId, session);
      if (isClosed(poll, now())) throw new HttpError(409, 'Опрос завершён.');
      const selections = voteInput(body, poll);
      await polls.updateOne({ _id: poll._id }, { $inc: { revision: 1 } }, { session });
      if (!selections.length) await ballots.deleteOne({ pollId: poll._id, userId: uid }, { session });
      else await ballots.updateOne({ pollId: poll._id, userId: uid }, { $set: { selections, updatedAt: now() } }, { upsert: true, session });
    });
    return get(body.pollId);
  }
  async function close(body) {
    exact(body, ['pollId']);
    const poll = await access(body.pollId);
    if (poll.creatorId !== uid && !admin) throw new HttpError(403, 'Завершить опрос может автор или администратор.');
    await polls.updateOne({ _id: poll._id, status: 'open' }, { $set: { status: 'closed', closedAt: now() }, $inc: { revision: 1 } });
    return get(body.pollId);
  }
  async function voters(id, optionId, offset) {
    const poll = await access(id);
    if (poll.anonymous) throw new HttpError(403, 'Опрос анонимный.');
    if (!Number.isSafeInteger(offset) || offset < 0 || !poll.options.some(option => option.id === optionId)) throw new HttpError(400, 'Некорректный вариант или страница.');
    const own = await ballots.findOne({ pollId: id, userId: uid });
    if (!resultsVisible(poll, own?.selections, now())) throw new HttpError(403, 'Имена доступны вместе с результатами после голосования.');
    const rows = await ballots.find({ pollId: id, selections: optionId }, { projection: { userId: 1 } }).sort({ userId: 1 }).skip(offset).limit(26).toArray();
    const users = await Promise.all(rows.slice(0,25).map(async row => {
      const user = await core.Users.findOneById(row.userId, { projection: { name: 1, username: 1 } });
      return { name: user?.name || user?.username || 'Удалённая учётная запись', username: user?.username || null };
    }));
    return { users, nextOffset: rows.length > 25 ? offset + 25 : null };
  }
  return { get, create, vote, close, voters };
}
module.exports = { createService };
