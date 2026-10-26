const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const fixture = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json')));
const env = Object.fromEntries(fs.readFileSync(path.join(local, '.env'), 'utf8').trim().split('\n').map(line => { const n = line.indexOf('='); return [line.slice(0, n), line.slice(n + 1)]; }));
const base = process.env.AI_TEST_BASE || 'http://localhost:3000';
async function request(name, auth = {}, body) {
  const response = await fetch(base + '/api/v1/' + name, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ...await response.json(), status: response.status };
}
async function login(user, password) { const result = await request('login', {}, { user, password }); assert.equal(result.status, 200); return { 'X-User-Id': result.data.userId, 'X-Auth-Token': result.data.authToken }; }
async function wait(job, auth) {
  for (let n = 0; n < 900; n++) {
    const result = await request('local-ai/jobs/' + job.id, auth); assert.equal(result.status, 200);
    if (result.job.status === 'done') return result.job;
    if (['cancelled', 'failed'].includes(result.job.status)) throw new Error(result.job.error);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for archive job');
}
(async () => {
  let admin, alice, bob;
  try {
    admin = await login(env.ADMIN_USERNAME, env.ADMIN_PASS); alice = await login(fixture.users[0].username, fixture.users[0].password); bob = await login(fixture.users[1].username, fixture.users[1].password);
    const file = path.join(local, '.state/ai-archive-fixture.json'); let room;
    if (fs.existsSync(file)) room = JSON.parse(fs.readFileSync(file));
    else {
      const created = await request('channels.create', admin, { name: 'ai-archive-' + Date.now().toString(36), members: fixture.users.map(user => user.username) });
      assert.equal(created.status, 200); room = { id: created.channel._id };
      for (let n = 0; n < 111; n++) {
        const result = await request('chat.postMessage', admin, { roomId: room.id, text: n === 0 ? 'Архивная запись. '.repeat(120) + 'МАРКЕРГЛУБИНЫ: запуск в субботу 12:45.' : 'МАРКЕРГЛУБИНЫ: запись номер ' + n });
        assert.equal(result.status, 200); if (!n) room.first = result.message._id;
      }
      fs.writeFileSync(file, JSON.stringify(room), { mode: 0o600 });
    }
    const created = await request('local-ai/jobs', alice, { operation: 'search', roomId: room.id, query: 'МАРКЕРГЛУБИНЫ', generate: false });
    assert.equal(created.status, 202, created.error);
    assert.equal((await request('local-ai/jobs/' + created.job.id, bob)).status, 404);
    assert.equal((await request('local-ai/jobs/' + created.job.id + '/cancel', bob, {})).status, 404);
    await wait(created.job, alice);
    const result = await request('local-ai/jobs/' + created.job.id + '/result', alice);
    assert.equal(result.status, 200, result.error); assert.equal(result.meta.scanned, 111);
    const matches = [...result.sources]; let offset = result.nextOffset;
    while (offset != null) {
      const page = await request('local-ai/jobs/' + created.job.id + '/result?offset=' + offset, alice);
      assert.equal(page.status, 200, page.error); matches.push(...page.sources); offset = page.nextOffset;
    }
    assert.equal(matches.length, 111); assert.equal(matches.length, result.total); assert.ok(matches.some(item => item.id === room.first && item.text.includes('МАРКЕРГЛУБИНЫ')));
    console.log('PASS: real full-history search reads 111 messages, earliest source, text beyond 1200, all result pages, owner isolation');
    const pending = await request('local-ai/jobs', alice, { operation: 'summary', roomId: room.id }); assert.equal(pending.status, 202);
    const cancelled = await request('local-ai/jobs/' + pending.job.id + '/cancel', alice, {}); assert.equal(cancelled.job.status, 'cancelled');
    console.log('PASS: live background job cancellation');
    if (process.env.AI_TEST_SUMMARY === '1') {
      const summary = await request('local-ai/jobs', alice, { operation: 'summary', roomId: room.id }); assert.equal(summary.status, 202);
      const done = await wait(summary.job, alice); assert.equal(done.progress.scanned, 111); assert.ok(done.progress.modelCalls > 1);
      const generated = await request('local-ai/jobs/' + summary.job.id + '/result', alice); assert.equal(generated.status, 200, generated.error);
      assert.equal(generated.meta.scanned, 111); assert.match(generated.answer, /\[\d+\]/);
      console.log('PASS: real multi-pass summary processes all 111 messages with source citations');
    }
  } finally { for (const auth of [admin, alice, bob].filter(Boolean)) await request('logout', auth, {}).catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
