const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const fixture = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json')));
const env = Object.fromEntries(fs.readFileSync(path.join(local, '.env'), 'utf8').trim().split('\n').map(line => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
}));
const base = process.env.AI_TEST_BASE || 'http://localhost:3000';

async function request(endpoint, auth = {}, body) {
  const response = await fetch(base + endpoint, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(300000),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  return { status: response.status, data };
}
async function login(user, password) {
  const result = await request('/api/v1/login', {}, { user, password });
  assert.equal(result.status, 200, 'Login failed');
  return { 'X-User-Id': result.data.data.userId, 'X-Auth-Token': result.data.data.authToken };
}
const api = (name, auth, body) => request('/api/v1/' + name, auth, body);
const ai = (name, auth, body) => api('local-ai/' + name, auth, body);

async function setup(admin, alice, bob) {
  const file = path.join(local, '.state/ai-fixture.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file));
  const suffix = Date.now().toString(36);
  const room = await api('channels.create', admin, { name: 'ai-demo-' + suffix, members: fixture.users.map(user => user.username) });
  assert.equal(room.status, 200);
  const shared = room.data.channel;
  const first = await api('chat.postMessage', alice, { roomId: shared._id, text: 'Учебный пример для проверки ИИ: запуск проекта «Ласточка» состоится в пятницу в 18:30 по Москве. Ответственная — Мария Соколова.' });
  const second = await api('chat.postMessage', bob, { roomId: shared._id, text: 'В учебном примере подтвердили пятницу, 18:30. Мария Соколова откроет доступ к стенду перед запуском.' });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const group = await api('groups.create', admin, { name: 'ai-private-' + suffix, members: [fixture.users[1].username] });
  assert.equal(group.status, 200);
  const privateMessage = await api('chat.postMessage', bob, { roomId: group.data.group._id, text: 'Тестовый закрытый код AI-PRIVATE-741929. Эта запись доступна только участникам закрытого канала.' });
  assert.equal(privateMessage.status, 200);
  const result = { roomId: shared._id, roomName: shared.name, messageIds: [first.data.message._id, second.data.message._id], privateRoomId: group.data.group._id, privateMessageId: privateMessage.data.message._id };
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  return result;
}

async function main() {
  let admin; let alice; let bob;
  const began = Date.now();
  try {
    admin = await login(env.ADMIN_USERNAME, env.ADMIN_PASS);
    alice = await login(fixture.users[0].username, fixture.users[0].password);
    bob = await login(fixture.users[1].username, fixture.users[1].password);
    const data = await setup(admin, alice, bob);
    const health = await ai('status', alice);
    assert.equal(health.status, 200); assert.equal(health.data.ready, true, 'Local models are not ready');
    assert.equal((await ai('status', {})).status, 401);
    assert.equal((await ai('status', { ...alice, 'X-User-Id': fixture.users[1].id })).status, 401);
    assert.equal((await ai('search', alice, { query: 'test', userId: fixture.users[1].id })).status, 400);
    assert.equal((await ai('search', alice, { query: 'x'.repeat(501) })).status, 400);
    assert.equal((await ai('search', alice, { query: 'код', roomId: data.privateRoomId })).status, 403);
    assert.equal((await ai('answer', alice, { query: 'Код?', messageIds: [data.privateMessageId] })).status, 403);
    assert.equal((await ai('summary', alice, { roomId: data.privateRoomId })).status, 403);
    console.log('PASS: authentication, request validation and private-room isolation');

    const privateSearch = await ai('search', bob, { query: 'Какой закрытый код?', roomId: data.privateRoomId });
    assert.equal(privateSearch.status, 200, privateSearch.data.error);
    assert.ok(privateSearch.data.sources.some(item => item.id === data.privateMessageId));
    const isolation = await ai('search', alice, { query: 'Какой закрытый код?' });
    assert.equal(isolation.status, 200, isolation.data.error);
    assert.ok(!JSON.stringify(isolation.data).includes('741929'));
    assert.ok(!isolation.data.sources.some(item => item.id === data.privateMessageId));
    console.log('PASS: cached private embeddings do not leak to another account');

    const question = 'Когда и во сколько начнётся учебный проект?';
    const found = await ai('search', alice, { query: question, roomId: data.roomId });
    assert.equal(found.status, 200, found.data.error);
    assert.ok(found.data.sources.some(item => data.messageIds.includes(item.id)), 'Semantic retrieval missed fixture');
    const generated = await ai('answer', alice, { query: question, messageIds: found.data.sources.map(item => item.id) });
    assert.equal(generated.status, 200, generated.data.error);
    assert.match(generated.data.answer, /18[:.\s]?30|18\s*час.{0,12}30/, 'Answer must preserve the source time');
    assert.match(generated.data.answer, /\[\d+\]/, 'Answer must cite sources');
    console.log('PASS: real semantic retrieval and Russian answer with valid source citations');
    console.log('Answer:', generated.data.answer);

    const summary = await ai('summary', alice, { roomId: data.roomId });
    assert.equal(summary.status, 200, summary.data.error);
    assert.match(summary.data.answer, /\[\d+\]/);
    console.log('PASS: room summary generated from authorized source messages');
    fs.writeFileSync(path.join(local, '.state/ai-live-report.json'), JSON.stringify({
      checked_at: new Date().toISOString(), base, seconds: (Date.now() - began) / 1000,
      authentication: 'pass', private_access: 'pass', private_cache_isolation: 'pass',
      semantic_search: 'pass', cited_answer: 'pass', room_summary: 'pass', answer: generated.data.answer,
    }, null, 2) + '\n', { mode: 0o600 });
  } finally {
    for (const auth of [admin, alice, bob]) if (auth) await api('logout', auth, {}).catch(() => {});
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
