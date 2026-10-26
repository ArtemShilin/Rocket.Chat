const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createArchive } = require('../archive.cjs');
const { createQueue } = require('../jobs.cjs');
const { chunks, reduceAll } = require('../chunks.cjs');
const { textHash, HttpError } = require('../domain.cjs');
function collection() {
  const data = [];
  function matches(item, query) { return Object.entries(query).every(([key, value]) => value && typeof value === 'object' ? ('$in' in value ? value.$in.includes(item[key]) : '$gt' in value ? item[key] > value.$gt : true) : item[key] === value); }
  return { data, insertOne: async item => data.push(item), countDocuments: async query => data.filter(item => matches(item, query)).length,
    updateOne: async (key, update) => { const existing = data.find(item => item._id === key._id); if (existing) Object.assign(existing, update.$set); else data.push({ ...key, ...update.$set }); },
    find: query => { let rows = data.filter(item => matches(item, query)); const cursor = { sort(order) { rows.sort((a, b) => { for (const [key, dir] of Object.entries(order)) if (a[key] !== b[key]) return a[key] > b[key] ? dir : -dir; return 0; }); return cursor; }, skip(n) { rows = rows.slice(n); return cursor; }, limit(n) { rows = rows.slice(0, n); return cursor; }, toArray: async () => rows }; return cursor; },
  };
}
function fixture(count = 805, roomCount = 53) {
  const rooms = Array.from({ length: roomCount }, (_, i) => ({ rid: 'r' + i }));
  const messages = Array.from({ length: count }, (_, i) => ({ id: 'm' + i, roomId: rooms[i % roomCount].rid, text: 'запуск ' + i + (i === count - 1 ? 'я'.repeat(5000) + 'ИСКОМОЕ' : '') }));
  let permitted = true;
  const reader = { authorize: async () => { if (!permitted) throw new HttpError(401, 'expired'); }, rooms: async () => rooms, room: async rid => rooms.find(item => item.rid === rid),
    batches: async function *(room) { yield messages.filter(item => item.roomId === room.rid); },
    get: async (ids, expected = []) => { if (!permitted) throw new HttpError(403, 'revoked'); return ids.map(id => { const item = messages.find(row => row.id === id); const old = expected.find(row => row.messageId === id); if (!item || old && old.hash !== textHash(item.text)) throw new HttpError(409, 'changed'); return item; }); } };
  const seen = []; let calls = 0;
  const models = { embeddingIdentity: async () => 'model', embed: async texts => { seen.push(...texts); return texts.map(() => [1, 0]); }, reduce: async (q, notes) => { calls++; const refs = [...new Set(notes.flatMap(note => note.refs))]; return JSON.stringify({ answer: 'Сводка ' + refs.map(n => `[${n}]`).join(' '), citations: refs }); } };
  const references = collection(); const hits = collection(); const cache = collection(); const controller = new AbortController();
  const archive = createArchive({ reader, models, references, hits, cache, signal: controller.signal, job: { id: 'job', uid: 'alice', startedAt: new Date().toISOString() }, progress: () => {} });
  return { archive, references, hits, cache, messages, seen, models, controller, revoke: () => { permitted = false; }, calls: () => calls };
}
test('all 805 messages in 53 rooms and text after 1200 characters are searched without top-six cutoff', async () => {
  const f = fixture(); const result = await f.archive.search('запуск');
  assert.equal(result.meta.scanned, 805); assert.equal(result.meta.rooms, 53); assert.equal(result.meta.total, 805);
  assert.equal(f.references.data.length, 805); assert.equal(f.hits.data.length, 805);
  assert.ok(f.seen.some(text => text.includes('ИСКОМОЕ')));
  const before = f.cache.data.length; await f.archive.search('запуск'); assert.equal(f.cache.data.length, before);
});
test('summary processes more than six full messages, including their final chunks', async () => {
  const f = fixture(15, 1); const seen = [];
  f.models.reduce = async (q, notes) => { seen.push(...notes); return JSON.stringify({ answer: 'Итог [1]', citations: [notes[0].refs[0]] }).replace('[1]', `[${notes[0].refs[0]}]`); };
  const result = await f.archive.summary('r0'); assert.equal(result.meta.scanned, 15);
  assert.equal(f.references.data.length, 15); assert.ok(seen.some(note => note.text.includes('ИСКОМОЕ')));
});
test('revocation, edited sources and cancellation invalidate results', async () => {
  const f = fixture(2, 1); await f.archive.search('запуск'); f.messages[0].text += 'edited';
  await assert.rejects(f.archive.verify(), { status: 409 }); f.revoke(); await assert.rejects(f.archive.verify(), { status: 401 });
  const cancelled = fixture(); cancelled.controller.abort(); await assert.rejects(cancelled.archive.search('запуск'));
});
test('UTF8 chunks preserve complete content', () => {
  const text = '🙂русский'.repeat(2000); const parts = [...chunks(text)]; assert.equal(parts.join(''), text); assert.ok(parts.every(part => Buffer.byteLength(part) <= 2000));
});
test('queue isolates ownership, serializes models and cancels running/queued jobs', async () => {
  const queue = createQueue(); let release; const hold = new Promise(resolve => { release = resolve; }); const order = [];
  const a = queue.submit('alice', 'search', async () => { order.push('a'); await hold; return {}; });
  assert.throws(() => queue.get(a.id, 'bob'), { status: 404 });
  assert.throws(() => queue.submit('alice', 'search', async () => ({})), { status: 409 });
  const b = queue.submit('bob', 'search', async () => { order.push('b'); return {}; });
  queue.cancel(b.id, 'bob'); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(order, ['a']);
  queue.cancel(a.id, 'alice'); release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.status, 'cancelled'); assert.equal(b.status, 'cancelled'); assert.deepEqual(order, ['a']);
});
test('source-only model output is rejected and inline citations work without a redundant array', () => {
  const { parseNote } = require('../chunks.cjs');
  assert.throws(() => parseNote('{"answer":"[1][2]","citations":[1,2]}', new Set([1,2])), { status: 502 });
  assert.deepEqual(parseNote('{"answer":"В 18:30 [1]"}', new Set([1])), { text: 'В 18:30 [1]', refs: [1] });
});
