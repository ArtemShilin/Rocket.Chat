const { HttpError, textHash, cosine, keywordScore } = require('./domain.cjs');
const { chunks, average, reduceAll } = require('./chunks.cjs');

function createArchive({ reader, models, cache, references, hits, job, progress, signal }) {
  let serial = 0; let scanned = 0; let parts = 0; let done = 0;
  const expiry = () => new Date(Date.now() + 86400000);
  const ensure = async () => { signal.throwIfAborted(); await reader.authorize(); };

  async function add(item) {
    const n = ++serial;
    await references.insertOne({ _id: `${job.id}:${n}`, jobId: job.id, uid: job.uid, n,
      messageId: item.id, rid: item.roomId, hash: textHash(item.text), expiresAt: expiry() });
    return n;
  }

  async function verify() {
    progress({ phase: 'verify' });
    let last = 0;
    while (true) {
      await ensure();
      const batch = await references.find({ jobId: job.id, n: { $gt: last } }).sort({ n: 1 }).limit(100).toArray();
      if (!batch.length) break;
      await reader.get(batch.map(item => item.messageId), batch);
      last = batch[batch.length - 1].n;
    }
  }

  async function *notesForMessages(input) {
    for await (const item of input) {
      await ensure();
      const n = item.n || await add(item);
      for (const text of chunks(item.text)) { parts++; yield { text: `[${n}] ${text}`, refs: [n] }; }
      if (!item.n) scanned++;
      progress({ scanned, parts });
    }
  }

  async function compactQuestion(query) {
    if (Buffer.byteLength(query) <= 800) return query;
    progress({ phase: 'question' });
    async function *input() { let n = 0; for (const text of chunks(query)) yield { text, refs: [++n] }; }
    const note = await reduceAll(input(), models, 'Сохрани все требования и вопросы пользователя в краткой формулировке.', 'question', progress);
    return note.text.replace(/\[\d+\]/g, '');
  }

  async function render(note) {
    const records = await references.find({ jobId: job.id, n: { $in: note.refs } }).toArray();
    const byNumber = new Map(records.map(record => [record.n, record]));
    const ordered = note.refs.map(n => byNumber.get(n)).filter(Boolean);
    const sources = ordered.length ? await reader.get(ordered.map(record => record.messageId), ordered) : [];
    const numbers = new Map(ordered.map((record, index) => [record.n, index + 1]));
    const answer = note.text.replace(/\[(\d+)\]/g, (_, n) => numbers.has(Number(n)) ? `[${numbers.get(Number(n))}]` : '');
    return { answer, answerSources: sources, sources, extractive: note.extractive === true };
  }

  async function summary(roomId) {
    const room = await reader.room(roomId);
    progress({ phase: 'summary', rooms: 1 });
    async function *all() { for await (const batch of reader.batches(room, new Date(job.startedAt))) for (const item of batch) yield item; }
    const note = await reduceAll(notesForMessages(all()), models, 'Сделай сводку всей истории: основные темы, решения и открытые вопросы. Планы не описывай как уже выполненные действия.', 'summary', progress);
    await verify();
    return { ...await render(note), meta: { scanned, rooms: 1, parts, summary: true } };
  }

  async function search(query, roomId, generate) {
    const rooms = roomId ? [await reader.room(roomId)] : await reader.rooms();
    progress({ phase: 'index', rooms: rooms.length, scanned: 0, roomsDone: 0 });
    const identity = await models.embeddingIdentity();
    const questionParts = [...chunks(query)]; const questionVectors = [];
    for (let i = 0; i < questionParts.length; i += 16) questionVectors.push(...await models.embed(questionParts.slice(i, i + 16)));
    const questionVector = average(questionVectors);
    for (const room of rooms) {
      for await (const batch of reader.batches(room, new Date(job.startedAt))) {
        for (const item of batch) {
          await ensure();
          const n = await add(item); const hash = textHash(item.text);
          let score = -Infinity; let bestText = ''; let ordinal = 0;
          const messageParts = [...chunks(item.text)];
          for (let i = 0; i < messageParts.length; i += 16) {
            const partBatch = messageParts.slice(i, i + 16);
            const keys = partBatch.map((_, index) => `v2:${identity}:${item.id}:${hash}:${i + index}`);
            const stored = await cache.find({ _id: { $in: keys } }).toArray();
            const vectors = new Map(stored.map(record => [record._id, record.vector]));
            const missing = keys.map((key, index) => ({ key, index })).filter(record => !vectors.has(record.key));
            if (missing.length) {
              const embeddings = await models.embed(missing.map(record => partBatch[record.index]));
              for (let k = 0; k < missing.length; k++) {
                const vector = embeddings[k];
                if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) throw new HttpError(502, 'Некорректный вектор модели.');
                vectors.set(missing[k].key, vector);
                await cache.updateOne({ _id: missing[k].key }, { $set: { vector, expiresAt: new Date(Date.now() + 7 * 86400000) } }, { upsert: true });
              }
            }
            for (let k = 0; k < partBatch.length; k++) {
              const semantic = cosine(questionVector, vectors.get(keys[k]));
              const keyword = keywordScore(query, partBatch[k]);
              const rank = 0.75 * semantic + 0.25 * keyword;
              if ((semantic >= 0.35 || keyword >= 0.5) && rank > score) { score = rank; bestText = String(i + k); }
              ordinal++;
            }
          }
          if (Number.isFinite(score)) await hits.insertOne({ _id: `${job.id}:${item.id}`, jobId: job.id, uid: job.uid, n,
            messageId: item.id, rid: item.roomId, hash, score, part: Number(bestText), expiresAt: expiry() });
          scanned++; parts += ordinal; progress({ scanned, parts, roomsDone: done });
        }
      }
      progress({ roomsDone: ++done });
    }
    await verify();
    const total = await hits.countDocuments({ jobId: job.id });
    let result = { sources: [], answerSources: [], meta: { scanned, rooms: rooms.length, parts, total } };
    if (generate && total) {
      progress({ phase: 'answer' });
      const question = await compactQuestion(query);
      async function *matches() {
        let offset = 0;
        while (true) {
          const records = await hits.find({ jobId: job.id }).sort({ n: 1 }).skip(offset).limit(100).toArray();
          if (!records.length) break;
          const sources = await reader.get(records.map(record => record.messageId), records);
          const numbers = new Map(records.map(record => [record.messageId, record.n]));
          for (const item of sources) yield { ...item, n: numbers.get(item.id) };
          offset += records.length;
        }
      }
      const note = await reduceAll(notesForMessages(matches()), models, question, 'answer', progress);
      await verify(); result = { ...result, ...await render(note) };
    }
    return result;
  }

  async function answer(query, ids) {
    const question = await compactQuestion(query);
    async function *all() { for (let i = 0; i < ids.length; i += 100) for (const item of await reader.get(ids.slice(i, i + 100))) yield item; }
    const note = await reduceAll(notesForMessages(all()), models, question, 'answer', progress);
    await verify();
    return { ...await render(note), meta: { scanned, parts } };
  }

  return { search, summary, answer, verify };
}

module.exports = { createArchive };
