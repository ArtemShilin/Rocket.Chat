const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const fixture = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json')));
const env = Object.fromEntries(fs.readFileSync(path.join(local, '.env'), 'utf8').trim().split('\n').map(line => { const n = line.indexOf('='); return [line.slice(0,n), line.slice(n+1)]; }));
const base = process.env.CANNED_TEST_BASE || 'http://localhost:3001';
async function request(route, auth = {}, body) {
  const response = await fetch(base + '/api/v1/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const api = (action, auth, body) => request('local-canned-responses/' + action, auth, body);
(async () => {
  const sessions = []; const created = []; const key = 'check_' + Date.now();
  async function login(user, password) { const result = await request('login', {}, { user, password }); assert.equal(result.status, 200); const auth = { 'X-User-Id': result.data.data.userId, 'X-Auth-Token': result.data.data.authToken }; sessions.push(auth); return auth; }
  async function create(auth, scope, suffix) {
    const shortcut = key + suffix;
    assert.equal((await api('save', auth, { shortcut, scope, text: 'Проверка шаблона' })).status, 200);
    const result = await api('list?q=' + shortcut, auth); assert.equal(result.status, 200);
    const item = result.data.items.find(row => row.shortcut === shortcut); assert.ok(item); created.push({ auth, item }); return item;
  }
  try {
    const admin = await login(env.ADMIN_USERNAME, env.ADMIN_PASS);
    const alice = await login(fixture.users[0].username, fixture.users[0].password);
    const bob = await login(fixture.users[1].username, fixture.users[1].password);
    assert.equal((await api('list')).status, 401);
    const personal = await create(alice, 'personal', '_private');
    assert.equal((await api('list?q=' + personal.shortcut, bob)).data.items.length, 0);
    assert.equal((await api('list?q=' + personal.shortcut, admin)).data.items.length, 0);
    assert.equal((await api('remove', bob, { id: personal._id, revision: 1 })).status, 409);
    const changes = { id: personal._id, revision: 1, shortcut: personal.shortcut, scope: 'personal', text: 'Обновлённый шаблон' };
    assert.equal((await api('save', alice, changes)).status, 200);
    personal.revision = 2;
    assert.equal((await api('save', alice, changes)).status, 409);
    assert.equal((await api('remove', alice, { id: personal._id, revision: 1 })).status, 409);
    assert.equal((await api('save', alice, { shortcut: key, scope: 'shared', text: 'deny' })).status, 403);
    const shared = await create(admin, 'shared', '_shared');
    assert.equal((await api('list?q=' + shared.shortcut, bob)).data.items[0].editable, false);
    assert.equal((await api('save', admin, { shortcut: shared.shortcut, scope: 'shared', text: 'duplicate' })).status, 409);
    assert.equal((await api('remove', alice, { id: shared._id, revision: 1 })).status, 409);
    console.log('Live API: authentication, personal isolation, shared visibility, admin permissions, version conflicts and unique index passed.');
  } finally {
    for (const { auth, item } of created) assert.equal((await api('remove', auth, { id: item._id, revision: item.revision })).status, 200);
    for (const auth of sessions) await request('logout', auth, {}).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
