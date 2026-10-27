const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./harness.cjs');
const { validate } = require('../domain.cjs');
test('validates untrusted payloads', () => {
  for (const value of [null, [], { scope: 'personal', shortcut: { $ne: '' }, text: 'x' }, { scope: 'other', shortcut: 'x', text: 'x' }, { scope: 'personal', shortcut: 'x', text: ' '.repeat(5) }, { scope: 'personal', shortcut: 'x', text: 'x', owner: 'admin' }]) assert.throws(() => validate(value), error => error.status === 400);
  assert.equal(validate({ scope: 'personal', shortcut: 'Привет', text: ' Ответ ' }).shortcut, 'привет');
});
test('HTTP: private isolation, shared roles, conflicts, injection, revoked sessions', async () => {
  const h = await harness();
  try {
    const api = h.api;
    assert.equal((await api('list')).status, 401);
    assert.equal((await api('save', 'alice', { shortcut: 'hello', text: 'private', scope: 'personal' })).status, 200);
    assert.equal((await api('list', 'bob')).data.items.length, 0);
    const alice = (await api('list', 'alice')).data.items[0];
    const mutation = { id: alice._id, revision: 1, shortcut: 'hello', text: 'stolen', scope: 'personal' };
    assert.equal((await api('save', 'bob', mutation)).status, 409);
    assert.equal((await api('save', 'admin', mutation)).status, 409);
    assert.equal((await api('remove', 'bob', { id: alice._id, revision: 1 })).status, 409);
    assert.equal((await api('save', 'alice', { shortcut: 'global', text: 'x', scope: 'shared' })).status, 403);
    assert.equal((await api('save', 'admin', { shortcut: 'global', text: '<img src=x onerror=alert(1)>', scope: 'shared' })).status, 200);
    const shared = (await api('list', 'bob')).data.items[0];
    assert.equal(shared.editable, false);
    assert.equal((await api('remove', 'alice', { id: shared._id, revision: 1 })).status, 409);
    assert.equal((await api('save', 'alice', { shortcut: 'hello', text: 'duplicate', scope: 'personal' })).status, 409);
    assert.equal((await api('save', 'bob', { shortcut: 'hello', text: 'own', scope: 'personal' })).status, 200);
    assert.equal((await api('save', 'alice', { ...mutation, text: 'updated' })).status, 200);
    assert.equal((await api('save', 'alice', mutation)).status, 409);
    assert.equal((await api('remove', 'alice', { id: alice._id, revision: 1 })).status, 409);
    assert.equal((await api('list?q=%5B', 'alice')).status, 200);
    assert.equal((await api('list?q=%5B', 'alice')).data.items.length, 0);
    assert.equal((await api('list?offset=-1', 'alice')).status, 400);
    assert.equal((await api('save', 'alice', { ...mutation, id: { $ne: null } })).status, 400);
    assert.equal((await api('remove', 'alice', { id: alice._id, revision: 2 })).status, 200);
    h.users.alice.services.resume.loginTokens = [];
    assert.equal((await api('list', 'alice')).status, 401);
    h.users.bob.active = false;
    assert.equal((await api('list', 'bob')).status, 401);
  } finally { await h.close(); }
});
test('HTTP: pagination, methods and static content headers', async () => {
  const h = await harness();
  try {
    for (let n = 0; n < 51; n++) assert.equal((await h.api('save', 'alice', { shortcut: 'item_' + n, text: 'value', scope: 'personal' })).status, 200);
    const first = await h.api('list', 'alice'); assert.equal(first.data.items.length, 50); assert.equal(first.data.nextOffset, 50);
    const last = await h.api('list?offset=50', 'alice'); assert.equal(last.data.items.length, 1); assert.equal(last.data.nextOffset, null);
    assert.equal((await h.api('save', 'alice')).status, 405);
    const page = await h.dispatch('/local-canned-responses'); assert.equal(page.status, 200); assert.match(page.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
    assert.equal((await h.dispatch('/local-canned-responses/../package.json')).status, 404);
  } finally { await h.close(); }
});
