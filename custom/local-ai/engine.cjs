const { HttpError, visibleText, textHash, rank, source, groundedAnswer } = require('./domain.cjs');

const LIMITS = { rooms: 50, perRoom: 100, messages: 600 };

function createEngine({ chat, models, cache }) {
  async function rooms() {
    const result = await chat('subscriptions.get');
    return (result.update || []).filter(room => ['c', 'p', 'd'].includes(room.t) && room.status !== 'BANNED' && !room.encrypted)
      .sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
  }

  async function currentSources(ids, prior = []) {
    const subscribed = new Map((await rooms()).map(room => [room.rid, room]));
    const result = await chat('chat.getMessages', { messageIds: [...new Set(ids)] });
    const byId = new Map((result.messages || []).map(message => [message._id, message]));
    return ids.map(id => {
      const message = byId.get(id);
      const room = subscribed.get(message?.rid);
      if (!room || !visibleText(message)) throw new HttpError(403, 'Источник больше недоступен. Повторите поиск.');
      const item = source(message, room);
      const old = prior.find(value => value.id === id);
      if (old && textHash(old.text) !== textHash(item.text)) throw new HttpError(409, 'Переписка изменилась во время обработки. Повторите запрос.');
      return item;
    });
  }

  async function history(room) {
    const endpoint = { c: 'channels.history', p: 'groups.history', d: 'im.history' }[room.t];
    const result = await chat(endpoint + '?' + new URLSearchParams({ roomId: room.rid, count: String(LIMITS.perRoom) }));
    return (result.messages || []).filter(visibleText).map(message => source(message, room));
  }

  async function search(query, roomId) {
    const available = await rooms();
    if (roomId && !available.some(room => room.rid === roomId)) throw new HttpError(403, 'Этот канал недоступен для поиска.');
    const selected = roomId ? available.filter(room => room.rid === roomId) : available.slice(0, LIMITS.rooms);
    const collected = [];
    for (const room of selected) {
      try { collected.push(...await history(room)); }
      catch (error) { if (![400, 403, 404].includes(error.status)) throw error; }
    }
    collected.sort((a, b) => new Date(b.date) - new Date(a.date));
    const messages = [...new Map(collected.map(message => [message.id, message])).values()].slice(0, LIMITS.messages);
    const meta = { scanned: messages.length, rooms: selected.length, limits: LIMITS, limited: (!roomId && available.length > LIMITS.rooms) || collected.length > LIMITS.messages };
    if (!messages.length) return { sources: [], meta };
    const model = await models.embeddingIdentity();
    const keys = messages.map(message => `${model}:${message.id}:${textHash(message.text)}`);
    const stored = await cache.find({ _id: { $in: keys } }, { projection: { vector: 1 } }).toArray();
    const vectors = new Map(stored.map(item => [item._id, item.vector]));
    const missing = messages.map((message, index) => ({ message, key: keys[index] })).filter(item => !vectors.has(item.key));
    for (let index = 0; index < missing.length; index += 16) {
      const batch = missing.slice(index, index + 16);
      const result = await models.embed(batch.map(item => item.message.text));
      for (let n = 0; n < batch.length; n++) {
        const vector = result[n];
        if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) throw new HttpError(502, 'Некорректный ответ модели поиска.');
        vectors.set(batch[n].key, vector);
        await cache.updateOne({ _id: batch[n].key }, { $set: { vector, expiresAt: new Date(Date.now() + 7 * 86400000) } }, { upsert: true });
      }
    }
    const [queryVector] = await models.embed([query]);
    const ranked = rank(query, queryVector, messages.map((message, index) => ({ ...message, vector: vectors.get(keys[index]) })));
    const sources = ranked.length ? await currentSources(ranked.map(message => message.id), ranked) : [];
    return { sources, meta };
  }

  async function answer(query, ids, mode = 'answer') {
    const sources = await currentSources(ids);
    const content = await models.generate(query, sources, mode);
    // Access and message content are checked again after the potentially slow model call.
    await currentSources(ids, sources);
    return { answer: groundedAnswer(content, sources), sources };
  }

  async function summary(roomId) {
    const room = (await rooms()).find(item => item.rid === roomId);
    if (!room) throw new HttpError(403, 'Этот канал недоступен для сводки.');
    const messages = (await history(room)).slice(0, 6).reverse();
    if (!messages.length) return { answer: 'В канале нет доступных текстовых сообщений для сводки.', sources: [] };
    return answer('Кратко изложи обсуждение: основные темы, подтверждённые решения и открытые вопросы.', messages.map(item => item.id), 'summary');
  }

  return { rooms, search, answer, summary };
}

module.exports = { createEngine, LIMITS };
