const path = require('node:path');
const assert = require('node:assert/strict');
const { harness } = require('./harness.cjs');
const { chromium } = require(require.resolve('playwright-core', { paths: [path.resolve(__dirname, '../../../deploy/local/.state/browser')] }));
(async () => {
  const h = await harness(); let browser;
  try {
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => { localStorage.setItem('Meteor.userId', 'alice'); localStorage.setItem('Meteor.loginToken', 'alice-token'); });
    await context.route('http://canned.test/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.pathname === '/test-chat') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><textarea class="js-input-message" aria-label="Message">Draft: </textarea><script defer src="/local-canned-responses/native.js"></script>' });
      const response = await h.dispatch(url.pathname + url.search, request.method(), request.headers(), request.postData() ? JSON.parse(request.postData()) : undefined);
      await route.fulfill({ status: response.status, headers: response.headers, body: response.text });
    });
    const page = await context.newPage();
    await page.goto('http://canned.test/local-canned-responses');
    await page.getByLabel('Название', { exact: true }).fill('greeting');
    await page.getByLabel('Текст ответа').fill('<img src=x onerror=alert(1)> Привет');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.locator('article').waitFor();
    assert.equal(await page.locator('article img').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto('http://canned.test/test-chat');
    const input = page.getByRole('textbox', { name: 'Message' }); await input.focus(); await input.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
    await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    assert.equal(await input.inputValue(), 'Draft: <img src=x onerror=alert(1)> Привет');
    await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
    await page.locator('article').waitFor();
    await page.evaluate(() => { localStorage.setItem('Meteor.userId', 'bob'); localStorage.setItem('Meteor.loginToken', 'bob-token'); });
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    assert.equal(await page.locator('article').count(), 0);
    console.log('Browser checks passed: create, literal text, mobile layout, native draft insertion, account switch.');
  } finally { await browser?.close(); await h.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
