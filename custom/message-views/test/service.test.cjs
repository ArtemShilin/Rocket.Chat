const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createService } = require('../service.cjs');
const { validate, versionOf, RETENTION_MS } = require('../domain.cjs');
const { HttpError } = require('../../local-ai/domain.cjs');

function setup() {
  const rows = []; let date = new Date('2026-10-27T10:00:00Z');
  const message = { _id: 'message1', rid: 'room1', u: { _id: 'alice' }, msg: 'Текст сообщения', ts: date };
  const members = new Set(['alice', 'bob', 'carol']);
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => value && typeof value === 'object'
    ? ('$gt' in value ? row[key] > value.$gt : row[key] <= value.$lte) : row[key] === value);
  const collection = {
    async createIndex() {},
    async findOne(filter) { return rows.find(row => matches(row, filter)); },
    find(filter) {
      let found = rows.filter(row => matches(row, filter));
      return { sort() { found.sort((a,b) => a.at - b.at || a.userId.localeCompare(b.userId)); return this; }, skip(n) { found = found.slice(n); return this; }, limit(n) { found = found.slice(0,n); return this; }, async toArray() { return found; } };
    },
    async deleteOne(filter) { const n = rows.findIndex(row => matches(row, filter)); if (n >= 0) rows.splice(n,1); },
    async updateOne(filter, update) { if (!rows.some(row => matches(row,filter))) rows.push({ ...update.$setOnInsert }); },
  };
  const core = {
    Messages: { findVisibleByIds: ids => ({ toArray: async () => ids.includes(message._id) && !message._hidden ? [message] : [] }) },
    Users: { findOneById: async id => ({ _id: id, username: id, services: { resume: { loginTokens: [{ hashedToken: id, when: date }] } } }) },
  };
  const service = uid => createService({ collection, core, uid, now: () => date, reader: {
    async authorize() { if (!members.has(uid)) throw new HttpError(401, 'Session revoked'); },
    async room(rid) { if (rid !== 'room1' || !members.has(uid)) throw new HttpError(403, 'No access'); },
  } });
  return { rows, message, members, service, core, collection, now: () => date, advance: ms => { date = new Date(date.getTime() + ms); } };
}

test('untrusted identities, timestamps, operators and versions are rejected', () => {
  for (const input of [null, [], {}, { messageId: { $ne: null } }, { messageId: 'x', userId: 'alice' }, { messageId: 'x', at: new Date() }]) assert.throws(() => validate(input), error => error.status === 400);
  assert.throws(() => validate({ messageId: 'x', version: 'bad' }, true), error => error.status === 400);
});

test('only explicit confirmation creates a record; server timestamp is idempotent', async () => {
  const h = setup(); const bob = h.service('bob');
  const preview = await bob.inspect({ messageId: 'message1' });
  assert.equal(h.rows.length, 0); assert.equal(preview.author, false); assert.equal(preview.readers, undefined);
  const first = await bob.acknowledge({ messageId: 'message1', version: preview.version });
  h.advance(50000);
  const second = await bob.acknowledge({ messageId: 'message1', version: preview.version });
  assert.equal(h.rows.length, 1); assert.deepEqual(first.confirmedAt, second.confirmedAt);
  assert.equal(h.rows[0].expiresAt - h.rows[0].at, RETENTION_MS);
  const author = await h.service('alice').inspect({ messageId: 'message1' });
  assert.equal(author.readers[0].username, 'bob'); assert.deepEqual(author.readers[0].at, first.confirmedAt);
});

test('only the author sees other readers and authors cannot confirm themselves', async () => {
  const h = setup(); const version = versionOf(h.message);
  await h.service('bob').acknowledge({ messageId: 'message1', version });
  const other = await h.service('carol').inspect({ messageId: 'message1' });
  assert.equal(other.readers, undefined); assert.equal(other.confirmedAt, null);
  await assert.rejects(h.service('alice').acknowledge({ messageId: 'message1', version }), error => error.status === 403);
  h.members.delete('bob');
  await assert.rejects(h.service('bob').inspect({ messageId: 'message1' }), error => error.status === 401);
  h.members.delete('alice');
  await assert.rejects(h.service('alice').inspect({ messageId: 'message1' }), error => error.status === 401);
});

test('edited messages invalidate old previews and require a new confirmation', async () => {
  const h = setup(); const version = versionOf(h.message);
  await h.service('bob').acknowledge({ messageId: 'message1', version });
  h.message.msg = 'Исправленный текст'; h.message.editedAt = h.now();
  await assert.rejects(h.service('bob').acknowledge({ messageId: 'message1', version }), error => error.status === 409);
  assert.equal((await h.service('alice').inspect({ messageId: 'message1' })).readers.length, 0);
  await h.service('bob').acknowledge({ messageId: 'message1', version: versionOf(h.message) });
  assert.equal((await h.service('alice').inspect({ messageId: 'message1' })).readers.length, 1);
});

test('private, hidden, encrypted and system messages cannot be confirmed', async () => {
  for (const fields of [{ private: true }, { _hidden: true }, { t: 'e2e' }, { e2e: 'pending' }, { t: 'uj' }, { msg: '' }]) {
    const h = setup(); Object.assign(h.message, fields);
    await assert.rejects(h.service('bob').inspect({ messageId: 'message1' }), error => error.status === 404);
    assert.equal(h.rows.length, 0);
  }
});

test('expired records are hidden before TTL cleanup and may be confirmed again', async () => {
  const h = setup(); const version = versionOf(h.message);
  const first = await h.service('bob').acknowledge({ messageId: 'message1', version });
  h.advance(RETENTION_MS + 1);
  assert.equal((await h.service('alice').inspect({ messageId: 'message1' })).readers.length, 0);
  const second = await h.service('bob').acknowledge({ messageId: 'message1', version });
  assert.ok(second.confirmedAt > first.confirmedAt); assert.equal(h.rows.length, 1);
});

test('reader pagination is bounded and stable', async () => {
  const h = setup();
  for (let n = 0; n < 51; n++) h.rows.push({ messageId: 'message1', version: versionOf(h.message), userId: 'user' + n, at: h.now(), expiresAt: new Date(h.now().getTime() + RETENTION_MS) });
  const first = await h.service('alice').inspect({ messageId: 'message1' });
  assert.equal(first.readers.length, 50); assert.equal(first.nextOffset, 50);
  const last = await h.service('alice').inspect({ messageId: 'message1' }, 50);
  assert.equal(last.readers.length, 1); assert.equal(last.nextOffset, null);
  await assert.rejects(h.service('alice').inspect({ messageId: 'message1' }, -1), error => error.status === 400);
});

test('HTTP middleware rejects unauthenticated requests, bad methods and extra parameters', async () => {
  const h = setup(); let middleware;
  const handlers = { router: { stack: [] }, use(fn) { middleware = fn; this.router.stack.push({ handle: fn }); } };
  require('../server.cjs')({ Accounts: { _hashLoginToken: value => value, _tokenExpiration: () => new Date(Date.now() + 100000) }, core: h.core, WebApp: { rawConnectHandlers: handlers }, WebAppInternals: { registerBoilerplateDataCallback() {} }, MongoInternals: { defaultRemoteCollectionDriver: () => ({ mongo: { db: { collection: () => h.collection } } }) } });
  const dispatch = (action, method = 'GET', headers = {}, body) => new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]); Object.assign(req, { url: '/api/v1/message-views/' + action, method, headers });
    const res = { writeHead(status) { this.status = status; this.headersSent = true; }, end(data) { resolve({ status: this.status, data: JSON.parse(data) }); } };
    middleware(req, res, () => { throw new Error('Unexpected next'); });
  });
  assert.equal((await dispatch('inspect?messageId=message1')).status, 401);
  assert.equal((await dispatch('acknowledge')).status, 405);
  const headers = { 'x-user-id': 'bob', 'x-auth-token': 'bob' };
  assert.equal((await dispatch('inspect?messageId=message1&userId=alice', 'GET', headers)).status, 400);
  assert.equal((await dispatch('acknowledge', 'POST', headers, { messageId: 'message1', version: versionOf(h.message), userId: 'alice' })).status, 400);
  assert.equal(h.rows.length, 0);
});
