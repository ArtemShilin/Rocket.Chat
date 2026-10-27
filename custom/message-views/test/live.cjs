const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const fixture = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json')));
const env = Object.fromEntries(fs.readFileSync(path.join(local, '.env'), 'utf8').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0,i), line.slice(i+1)]; }));
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(local, '.state/browser')] }));
const base = process.env.VIEWS_TEST_BASE || 'http://localhost:3001';
async function request(route, auth = {}, body) {
  const response = await fetch(base + '/api/v1/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
(async () => {
  const sessions = []; let group, alice, browser;
  async function login(user, password) {
    const result = await request('login', {}, { user, password }); assert.equal(result.status, 200);
    const auth = { 'X-User-Id': result.data.data.userId, 'X-Auth-Token': result.data.data.authToken }; sessions.push(auth); return auth;
  }
  const inspect = (id, auth) => request('message-views/inspect?messageId=' + id, auth);
  try {
    alice = await login(fixture.users[0].username, fixture.users[0].password);
    const bob = await login(fixture.users[1].username, fixture.users[1].password);
    const admin = await login(env.ADMIN_USERNAME, env.ADMIN_PASS);
    const name = 'views-check-' + Date.now();
    const created = await request('groups.create', alice, { name, members: [fixture.users[1].username] });
    assert.equal(created.status, 200, created.data.error); group = created.data.group;
    const posted = await request('chat.postMessage', alice, { roomId: group._id, text: 'Проверка явного просмотра ' + name + ' <b>буквальный текст</b>' });
    assert.equal(posted.status, 200); const id = posted.data.message._id;
    assert.equal((await inspect(id)).status, 401);
    assert.equal((await inspect(id, admin)).status, 403);
    const preview = await inspect(id, bob); assert.equal(preview.status, 200); assert.equal(preview.data.readers, undefined);
    assert.equal((await request('message-views/acknowledge', alice, { messageId: id, version: preview.data.version })).status, 403);
    assert.equal((await request('message-views/acknowledge', bob, { messageId: id, version: preview.data.version, userId: alice['X-User-Id'] })).status, 400);

    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    async function pageFor(auth) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addInitScript(a => { localStorage.setItem('Meteor.userId', a['X-User-Id']); localStorage.setItem('Meteor.loginToken', a['X-Auth-Token']); }, auth);
      const page = await context.newPage(); page.setDefaultTimeout(60000); await page.goto(base + '/group/' + name);
      await page.locator('[data-mid="' + id + '"]').waitFor(); return page;
    }
    const recipient = await pageFor(bob);
    assert.equal((await inspect(id, alice)).data.readers.length, 0, 'Visible message must not cause automatic confirmation');
    const received = recipient.locator('[data-mid="' + id + '"]');
    await received.getByRole('button', { name: 'Подтвердить просмотр', exact: true }).click();
    const panel = recipient.locator('dialog.local-message-views'); await panel.getByRole('button', { name: 'Подтверждаю просмотр', exact: true }).waitFor();
    assert.equal(await panel.locator('pre').innerText(), posted.data.message.msg);
    assert.equal(await panel.locator('pre b').count(), 0);
    await panel.getByRole('button', { name: 'Подтверждаю просмотр', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'Просмотр подтверждён:' }).waitFor();
    const seen = (await inspect(id, alice)).data; assert.equal(seen.readers.length, 1); assert.equal(seen.readers[0].username, fixture.users[1].username);
    const timestamp = seen.readers[0].at;
    const latencies = [];
    for (let n = 0; n < 50; n++) {
      const started = performance.now();
      const result = await request('message-views/acknowledge', bob, { messageId: id, version: preview.data.version });
      assert.equal(result.status, 200); assert.equal(result.data.confirmedAt, timestamp); latencies.push(performance.now() - started);
    }
    assert.equal((await inspect(id, alice)).data.readers.length, 1);
    const author = await pageFor(alice);
    await author.locator('[data-mid="' + id + '"]').getByRole('button', { name: 'Кто подтвердил просмотр', exact: true }).click();
    await author.locator('.local-message-view-readers').getByText(fixture.users[1].username, { exact: false }).waitFor();
    await author.setViewportSize({ width: 390, height: 844 });
    const authorPanel = author.locator('dialog.local-message-views');
    assert.ok(await authorPanel.evaluate(el => el.scrollWidth <= el.clientWidth));
    await author.screenshot({ path: path.join(local, '.state/message-views-mobile.png'), fullPage: true });
    const edit = await request('chat.update', alice, { roomId: group._id, msgId: id, text: 'Исправленная версия ' + name }); assert.equal(edit.status, 200, edit.data.error);
    assert.equal((await inspect(id, alice)).data.readers.length, 0);
    assert.equal((await request('message-views/acknowledge', bob, { messageId: id, version: preview.data.version })).status, 409);
    const edited = await inspect(id, bob);
    assert.equal((await request('message-views/acknowledge', bob, { messageId: id, version: edited.data.version })).status, 200);
    assert.equal((await request('groups.kick', alice, { roomId: group._id, userId: bob['X-User-Id'] })).status, 200);
    assert.equal((await inspect(id, bob)).status, 403);
    assert.equal((await request('message-views/acknowledge', bob, { messageId: id, version: edited.data.version })).status, 403);
    await recipient.evaluate(a => { localStorage.setItem('Meteor.userId', a['X-User-Id']); localStorage.setItem('Meteor.loginToken', a['X-Auth-Token']); }, admin);
    await recipient.waitForFunction(() => !document.querySelector('dialog.local-message-views'));
    latencies.sort((a,b) => a-b);
    const report = { checkedAt: new Date().toISOString(), base, requests: 50, p50Ms: Math.round(latencies[25]), p95Ms: Math.round(latencies[47]), readerCountAfterRepeats: 1, checks: ['manual browser confirmation', 'no automatic tracking', 'author-only reader list', 'private room isolation', 'server timestamp idempotence', 'message edits', 'membership revocation', 'mobile dialog', 'literal text', 'account switch'] };
    fs.writeFileSync(path.join(local, '.state/message-views-report.json'), JSON.stringify(report,null,2)+'\n', { mode: 0o600 });
    console.log('PASS: browser confirmation, author reader list, no automatic tracking, private room isolation, edits, membership revocation and mobile layout.');
    console.log(`50 repeated confirmations: p50=${report.p50Ms} ms, p95=${report.p95Ms} ms; one reader record.`);
  } catch (error) {
    if (browser) for (const [n, context] of browser.contexts().entries()) {
      const page = context.pages()[0]; if (page) {
        await page.screenshot({ path: path.join(local, `.state/message-views-failure-${n}.png`), fullPage: true }).catch(() => {});
        fs.writeFileSync(path.join(local, `.state/message-views-failure-${n}.txt`), await page.locator('body').innerText().catch(() => ''), { mode: 0o600 });
      }
    }
    throw error;
  } finally {
    await browser?.close();
    if (group) { const deleted = await request('groups.delete', alice, { roomId: group._id }); assert.equal(deleted.status, 200, deleted.data.error); }
    for (const auth of sessions) await request('logout', auth, {}).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
