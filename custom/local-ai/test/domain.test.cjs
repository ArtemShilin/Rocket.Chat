const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRequest, visibleText, cosine, rank, groundedAnswer } = require('../domain.cjs');

test('invalid queries, impersonation parameters and untrusted message bodies are rejected', () => {
  for (const body of [{ query: 'a' }, { query: 'release', userId: 'other' }, { query: 'ok', roomId: { $ne: null } }]) {
    assert.throws(() => validateRequest(body, 'search'), { status: 400 });
  }
  assert.throws(() => validateRequest({ query: 'ok', messageIds: [], messages: [{ msg: 'invented' }] }, 'answer'), { status: 400 });
  assert.doesNotThrow(() => validateRequest({ query: 'x'.repeat(5000), messageIds: Array(70).fill('message') }, 'answer'));
  assert.equal(visibleText({ msg: 'x'.repeat(5000) }).length, 5000);
});

test('encrypted, deleted and system messages never become source text', () => {
  for (const t of ['e2e', 'rm', 'uj']) assert.equal(visibleText({ t, msg: 'private' }), null);
  assert.equal(visibleText({ msg: ' ' }), null);
  assert.equal(visibleText({ msg: 'real message' }), 'real message');
});

test('semantic retrieval finds meaning without exact keywords and retains keyword matches', () => {
  const results = rank('запуск', [1, 0], [
    { id: 'semantic', text: 'Релиз проекта в пятницу', vector: [1, 0] },
    { id: 'keyword', text: 'Запуск RC-42', vector: [0, 1] },
    { id: 'irrelevant', text: 'Обед в кафе', vector: [-1, 0] },
  ]);
  assert.deepEqual(results.map(item => item.id), ['semantic', 'keyword']);
  assert.equal(cosine([0, 0], [0, 0]), 0);
});

test('answers require valid source citations', () => {
  const sources = [{ id: 'm1' }];
  assert.equal(groundedAnswer('{"answer":"В пятницу [1]","citations":[1]}', sources), 'В пятницу [1]');
  assert.equal(groundedAnswer('{"answer":"В пятницу","citations":[1]}', sources), 'В пятницу [1]');
  assert.throws(() => groundedAnswer('{"answer":"Секрет [2]","citations":[2]}', sources), { status: 502 });
  assert.throws(() => groundedAnswer('not json', sources), { status: 502 });
  assert.match(groundedAnswer('{"answer":"Придуманный факт","citations":[]}', sources), /недостаточно/);
});
