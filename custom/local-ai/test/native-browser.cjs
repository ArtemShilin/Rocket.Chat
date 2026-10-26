const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(local, '.state/browser')] }));
const user = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json'))).users[0];
const base = process.env.AI_TEST_BASE || 'http://localhost:3000';
(async () => {
  const login = await fetch(base + '/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: user.username, password: user.password }) });
  const { data } = await login.json(); assert.ok(data?.authToken);
  const auth = { 'X-User-Id': data.userId, 'X-Auth-Token': data.authToken, 'Content-Type': 'application/json' };
  const preferences = await (await fetch(base + '/api/v1/users.getPreferences', { headers: auth })).json();
  const saved = preferences.preferences?.featuresPreview || [];
  const enable = await fetch(base + '/api/v1/users.setPreferences', { method: 'POST', headers: auth, body: JSON.stringify({ data: { featuresPreview: [...saved.filter(item => item.name !== 'aiSearch'), { name: 'aiSearch', value: true }] } }) });
  assert.ok(enable.ok);
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
    await context.addInitScript(data => { localStorage.setItem('Meteor.userId', data.userId); localStorage.setItem('Meteor.loginToken', data.authToken); }, data);
    const page = await context.newPage(); page.setDefaultTimeout(90000);
    await page.goto(base + '/home');
    await page.locator('#main-content').waitFor();
    await page.waitForFunction(() => Boolean(window.__localAISearchBridge));
    const input = page.locator('[role="search"] input').first(); await input.waitFor();
    await input.fill('Когда запуск проекта?');
    const button = page.getByRole('button', { name: 'AI-поиск по всей истории', exact: true }).first();
    await button.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('[role=search] button')].some(button => !button.hasAttribute('data-local-ai-button') && button.querySelector('.rcx-icon--name-stars')));
    assert.equal(await button.getAttribute('data-local-ai-button'), null, 'Expected the actual Rocket.Chat AI button with feature preview enabled');
    const opened = context.waitForEvent('page'); await button.click();
    const target = await opened; await target.waitForLoadState('domcontentloaded');
    assert.equal(new URL(target.url()).pathname, '/local-ai');
    await target.waitForFunction(() => document.getElementById('query')?.value === 'Когда запуск проекта?');
    assert.equal(await page.getByText('AI add-on required', { exact: true }).count(), 0);
    await input.fill('Повторный вопрос');
    assert.equal(await page.getByRole('button', { name: 'AI-поиск по всей истории', exact: true }).count(), 1);
    await page.screenshot({ path: path.join(local, '.state/ai-native-button.png') });
    console.log('PASS: native AI button, query handoff, no add-on dialog, no duplicate after React update');
  } finally {
    await browser.close();
    await fetch(base + '/api/v1/users.setPreferences', { method: 'POST', headers: auth, body: JSON.stringify({ data: { featuresPreview: saved } }) }).catch(() => {});
    await fetch(base + '/api/v1/logout', { method: 'POST', headers: { 'X-User-Id': data.userId, 'X-Auth-Token': data.authToken } }).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
