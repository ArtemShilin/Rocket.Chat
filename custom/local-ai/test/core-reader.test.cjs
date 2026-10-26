const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReader } = require('../core-reader.cjs');
const { textHash } = require('../domain.cjs');
function fixture() {
  const ts = new Date('2026-01-01');
  const data = Array.from({ length: 251 }, (_, n) => ({ _id: String(n).padStart(4, '0'), rid: 'r', ts, msg: 'текст ' + n }));
  let access = true; let active = true; let subscribed = true;
  const core = {
    Users: { findOneById: async uid => uid === 'u' ? { _id: 'u', active, services: { resume: { loginTokens: [{ hashedToken: 'hash', when: ts }] } } } : null },
    Subscriptions: { findOne: async () => subscribed ? { name: 'general' } : null, findByUserId: () => ({ toArray: async () => Array.from({ length: 75 }, (_, n) => ({ rid: 'r' + n })) }) },
    Rooms: { findOneById: async () => ({ t: 'c' }) }, canAccessRoomIdAsync: async () => access,
    Messages: { find: (query, options) => ({ toArray: async () => data.filter(item => item.rid === query.rid && item.ts <= query.ts.$lte && (!query.$or || item.ts > query.$or[0].ts.$gt || +item.ts === +query.$or[1].ts && item._id > query.$or[1]._id.$gt)).slice(0, options.limit) }), findVisibleByIds: ids => ({ toArray: async () => data.filter(item => ids.includes(item._id) && !item._hidden) }) },
  };
  const Accounts = { _hashLoginToken: token => token === 'token' ? 'hash' : 'wrong', _tokenExpiration: () => new Date(Date.now() + 999999) };
  return { reader: createReader({ core, Accounts }, 'u', 'token', new AbortController().signal), data, revoke: () => { access = false; }, disable: () => { active = false; }, unsubscribe: () => { subscribed = false; } };
}
test('native keyset pagination includes every equal-timestamp message and all 75 subscriptions', async () => {
  const f = fixture(); const all = [];
  for await (const batch of f.reader.batches({ rid: 'r', t: 'c', name: 'general' })) all.push(...batch);
  assert.equal(all.length, 251); assert.equal(new Set(all.map(item => item.id)).size, 251);
  assert.equal((await f.reader.rooms()).length, 75);
});
test('native reader enforces membership, stock access checks, edits, hidden messages and active account', async () => {
  const f = fixture(); const item = f.data[0];
  const expected = [{ messageId: item._id, hash: textHash(item.msg) }];
  await f.reader.get([item._id], expected); item.msg += 'изменение'; await assert.rejects(f.reader.get([item._id], expected), { status: 409 });
  item._hidden = true; await assert.rejects(f.reader.get([item._id]), { status: 409 });
  f.revoke(); await assert.rejects(f.reader.room('r'), { status: 403 });
  f.disable(); await assert.rejects(f.reader.authorize(), { status: 401 });
  const other = fixture(); other.unsubscribe(); await assert.rejects(other.reader.room('r'), { status: 403 });
});
