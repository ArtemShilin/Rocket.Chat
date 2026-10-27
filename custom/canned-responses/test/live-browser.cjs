const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const fixture = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json')));
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(local, '.state/browser')] }));
const base = process.env.CANNED_TEST_BASE || 'http://localhost:3001';
(async () => {
  let browser, auth, template, page;
  async function request(route, body) {
    const response = await fetch(base + '/api/v1/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, 200, data.error || route); return data;
  }
  try {
    const login = await request('login', { user: fixture.users[0].username, password: fixture.users[0].password });
    auth = { 'X-User-Id': login.data.userId, 'X-Auth-Token': login.data.authToken };
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(a => { localStorage.setItem('Meteor.userId', a['X-User-Id']); localStorage.setItem('Meteor.loginToken', a['X-Auth-Token']); }, auth);
    page = await context.newPage(); page.setDefaultTimeout(90000);
    const shortcut = 'browser_' + Date.now(); const marker = 'Черновик шаблона ' + shortcut;
    await page.goto(base + '/local-canned-responses');
    await page.getByLabel('Название', { exact: true }).fill(shortcut);
    await page.getByLabel('Текст ответа').fill(marker);
    const saved = page.waitForResponse(response => response.url().endsWith('/local-canned-responses/save'));
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    assert.equal((await saved).status(), 200);
    template = (await request('local-canned-responses/list?q=' + shortcut)).items[0]; assert.ok(template);
    console.log('PASS: template created through the real page');
    await page.goto(base + '/channel/' + fixture.channel_name);
    const composer = page.locator('textarea.js-input-message'); await composer.waitFor();
    console.log('PASS: real Rocket.Chat composer loaded');
    await composer.fill('До: ');
    await composer.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
    await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
    const panel = page.locator('dialog.local-canned'); await panel.waitFor();
    await panel.getByRole('searchbox').fill(shortcut); await panel.getByRole('button', { name: 'Найти', exact: true }).click();
    await panel.locator('article').filter({ hasText: shortcut }).getByRole('button', { name: 'Вставить', exact: true }).click();
    assert.equal(await composer.inputValue(), 'До: ' + marker);
    console.log('PASS: inserted into the real composer');
    // Rocket.Chat persists local drafts with a 300 ms debounce.
    await page.waitForFunction(({ rid, expected }) => localStorage.getItem('messagebox_' + rid) === expected, { rid: fixture.channel_id, expected: 'До: ' + marker });
    await page.reload(); await composer.waitFor();
    await page.waitForFunction(expected => document.querySelector('textarea.js-input-message')?.value === expected, 'До: ' + marker);
    const history = await request('channels.history?roomId=' + fixture.channel_id + '&count=100');
    assert.ok(history.messages.every(item => !item.msg?.includes(marker)), 'Template must remain a draft');
    await composer.fill('');
    await page.waitForFunction(rid => !localStorage.getItem('messagebox_' + rid), fixture.channel_id);
    await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(local, '.state/canned-responses-mobile.png'), fullPage: true });
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth));
    await panel.getByRole('button', { name: 'Закрыть', exact: true }).click();
    console.log('PASS: real Rocket.Chat creates a personal template, inserts into a draft, persists it after reload, sends no message, and displays the mobile dialog.');
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(local, '.state/canned-responses-failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(local, '.state/canned-responses-failure.txt'), await page.locator('body').innerText().catch(() => ''), { mode: 0o600 });
    }
    throw error;
  } finally {
    await browser?.close();
    if (template) await request('local-canned-responses/remove', { id: template._id, revision: template.revision });
    if (auth) await request('logout', {}).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
