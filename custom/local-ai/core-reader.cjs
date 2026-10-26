const { HttpError, visibleText, source, textHash } = require('./domain.cjs');

function createReader({ core, Accounts }, uid, token, signal) {
  const tokenHash = Accounts._hashLoginToken(token);
  async function authorize() {
    signal?.throwIfAborted();
    const user = await core.Users.findOneById(uid);
    const login = user?.services?.resume?.loginTokens?.find(item => item.hashedToken === tokenHash && !item.name);
    if (!user || user.active === false || !login || !login.when || Accounts._tokenExpiration(login.when) <= new Date()) {
      throw new HttpError(401, 'Вход завершён. Авторизуйтесь снова.');
    }
    return { id: user._id, username: user.username };
  }

  async function room(rid) {
    await authorize();
    const subscription = await core.Subscriptions.findOne({ rid, 'u._id': uid, status: { $ne: 'BANNED' } });
    const record = subscription && await core.Rooms.findOneById(rid);
    if (!record || !['c', 'p', 'd'].includes(record.t) || record.encrypted || !(await core.canAccessRoomIdAsync(rid, uid))) {
      throw new HttpError(403, 'Канал больше недоступен для вашей учётной записи.');
    }
    return { rid, t: record.t, name: subscription.name || record.name, fname: subscription.fname || record.fname };
  }

  async function rooms() {
    await authorize();
    const subscriptions = await core.Subscriptions.findByUserId(uid).toArray();
    const result = [];
    for (const subscription of subscriptions) {
      try { result.push(await room(subscription.rid)); }
      catch (error) { if (error.status !== 403) throw error; }
    }
    return result;
  }

  async function *batches(selected, cutoff = new Date()) {
    let last;
    while (true) {
      await room(selected.rid);
      const filter = { rid: selected.rid, _hidden: { $ne: true }, ts: { $lte: cutoff } };
      if (last) filter.$or = [{ ts: { $gt: last.ts } }, { ts: last.ts, _id: { $gt: last._id } }];
      const messages = await core.Messages.find(filter, {
        sort: { ts: 1, _id: 1 }, limit: 100,
        projection: { _id: 1, rid: 1, msg: 1, t: 1, u: 1, ts: 1, _hidden: 1 },
      }).toArray();
      if (!messages.length) break;
      last = messages[messages.length - 1];
      yield messages.filter(visibleText).map(message => source(message, selected));
      if (messages.length < 100) break;
    }
  }

  async function get(ids, expected = [], strict = true) {
    await authorize();
    const result = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const selected = ids.slice(offset, offset + 100);
      const messages = await core.Messages.findVisibleByIds(selected).toArray();
      const byId = new Map(messages.map(message => [message._id, message]));
      const access = new Map();
      for (const id of selected) {
        const message = byId.get(id);
        if (!message || !visibleText(message)) {
          if (strict) throw new HttpError(409, 'Источник удалён или изменён. Повторите запрос.');
          continue;
        }
        if (!access.has(message.rid)) {
          try { access.set(message.rid, await room(message.rid)); }
          catch (error) { if (strict || error.status !== 403) throw error; access.set(message.rid, null); }
        }
        if (!access.get(message.rid)) continue;
        const item = source(message, access.get(message.rid));
        const old = expected.find(value => (value.id || value.messageId) === id);
        if (old && (old.hash || textHash(old.text)) !== textHash(item.text)) {
          if (strict) throw new HttpError(409, 'Переписка изменилась во время обработки. Повторите запрос.');
          continue;
        }
        result.push(item);
      }
    }
    return result;
  }
  return { authorize, room, rooms, batches, get };
}

module.exports = { createReader };
