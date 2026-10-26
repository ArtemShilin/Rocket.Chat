const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(local, '.state/browser')] }));
const user = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json'))).users[0];
const fixture = JSON.parse(fs.readFileSync(path.join(local, '.state/ai-fixture.json')));
const base = process.env.AI_TEST_BASE || 'http://localhost:3000';

(async () => {
  const response = await fetch(base + '/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: user.username, password: user.password }) });
  const { data } = await response.json();
  assert.ok(data?.authToken);
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'en-US' });
    await context.addInitScript(({ userId, authToken }) => {
      localStorage.setItem('Meteor.userId', userId); localStorage.setItem('Meteor.loginToken', authToken);
    }, data);
    const page = await context.newPage();
    page.setDefaultTimeout(300000);
    await page.goto(base + '/local-ai');
    await page.waitForFunction(() => !document.getElementById('search').disabled);
    assert.equal(await page.locator('#summary').isDisabled(), true);
    await page.locator('#room').selectOption(fixture.roomId);
    assert.equal(await page.locator('#summary').isEnabled(), true);
    await page.locator('#query').fill('Когда и во сколько начнётся учебный проект?');
    await page.locator('#search').click();
    await page.locator('#answer-section').waitFor({ state: 'visible' });
    assert.match(await page.locator('#answer').innerText(), /18[:.\s]?30|18\s*час.{0,12}30/);
    assert.ok(await page.locator('#answer a').count());
    assert.ok(await page.locator('#sources article').count());
    assert.match(await page.locator('#sources a').first().getAttribute('href'), /\/channel\/.+\?msg=/);
    await page.screenshot({ path: path.join(local, '.state/ai-search.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(local, '.state/ai-search-mobile.png'), fullPage: true });
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(width.content <= width.viewport, 'Mobile page overflows');
    const otherTab = await context.newPage();
    await otherTab.goto(base + '/local-ai');
    await otherTab.evaluate(() => { localStorage.removeItem('Meteor.loginToken'); localStorage.removeItem('Meteor.userId'); });
    await page.waitForFunction(() => document.getElementById('sources-section').hidden && document.getElementById('answer-section').hidden);
    console.log('PASS: browser search, generated answer, source links, mobile layout and account-change clearing');
    fs.writeFileSync(path.join(local, '.state/ai-browser-report.json'), JSON.stringify({ checked_at: new Date().toISOString(), base, answer: 'pass', links: 'pass', mobile: 'pass', account_change: 'pass' }, null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    const page = context?.pages()[0];
    if (page) {
      await page.screenshot({ path: path.join(local, '.state/ai-browser-failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(local, '.state/ai-browser-failure.txt'), await page.locator('body').innerText().catch(() => ''));
    }
    throw error;
  } finally {
    await browser.close();
    await fetch(base + '/api/v1/logout', { method: 'POST', headers: { 'X-User-Id': data.userId, 'X-Auth-Token': data.authToken } }).catch(() => {});
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
