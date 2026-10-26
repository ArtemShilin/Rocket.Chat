const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../engine.cjs');

function fixture() {
  const publicRoom = { rid: 'room-public', name: 'general', t: 'c' };
  const message = { _id: 'message-public', rid: publicRoom.rid, msg: 'Релиз проекта состоится в пятницу.', ts: '2026-10-26T00:00:00Z', u: { username: 'alice' } };
  const secret = { _id: 'message-private', rid: 'room-secret', msg: 'Секретный код 923811', ts: message.ts };
  const state = { accessible: true, generated: false, afterGenerate: () => {} };
  const data = new Map();
  const cache = {
    find: ({ _id }) => ({ toArray: async () => [...data.values()].filter(item => _id.$in.includes(item._id)) }),
    updateOne: async (key, update) => data.set(key._id, { _id: key._id, ...update.$set }),
  };
  const chat = async (endpoint, body) => {
    if (endpoint === 'subscriptions.get') return { update: state.accessible ? [publicRoom] : [] };
    if (endpoint.startsWith('channels.history')) return { messages: [message, { ...message, _id: 'cipher', t: 'e2e' }] };
    if (endpoint === 'chat.getMessages') return { messages: [message, secret].filter(item => body.messageIds.includes(item._id)) };
    throw new Error(endpoint);
  };
  const models = {
    embeddingIdentity: async () => 'model-sha', embed: async texts => texts.map(() => [1, 0]),
    generate: async () => { state.generated = true; state.afterGenerate(); return '{"answer":"В пятницу [1]","citations":[1]}'; },
  };
  return { engine: createEngine({ chat, models, cache }), state, message, data };
}

test('search indexes only visible messages in the current user subscriptions', async () => {
  const { engine } = fixture();
  const result = await engine.search('Когда запуск?');
  assert.equal(result.meta.scanned, 1);
  assert.deepEqual(result.sources.map(item => item.id), ['message-public']);
  assert.ok(!JSON.stringify(result).includes('923811'));
  await assert.rejects(engine.search('секрет', 'room-secret'), { status: 403 });
});

test('guessed private message IDs are rejected before calling the language model', async () => {
  const { engine, state } = fixture();
  await assert.rejects(engine.answer('Код?', ['message-private']), { status: 403 });
  assert.equal(state.generated, false);
});

test('revoking room access during generation prevents answer disclosure', async () => {
  const { engine, state } = fixture();
  state.afterGenerate = () => { state.accessible = false; };
  await assert.rejects(engine.answer('Когда?', ['message-public']), { status: 403 });
});

test('editing a source during generation invalidates the pending answer', async () => {
  const { engine, state, message } = fixture();
  state.afterGenerate = () => { message.msg = 'Теперь релиз в понедельник'; };
  await assert.rejects(engine.answer('Когда?', ['message-public']), { status: 409 });
});

test('editing message text generates a new embedding cache key', async () => {
  const { engine, message, data } = fixture();
  await engine.search('Когда запуск?');
  assert.equal(data.size, 1);
  message.msg = 'Релиз перенесён на понедельник';
  await engine.search('Когда запуск?');
  assert.equal(data.size, 2);
});
