const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(__dirname, '.state/browser')] }));

const state = path.join(__dirname, '.state');
const fixture = JSON.parse(fs.readFileSync(path.join(state, 'fixture.json')));
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '.env'), 'utf8').trim().split('\n').map(line => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
const base = 'http://localhost:3000';

async function login(browser, username, password) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="usernameOrEmail"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form').filter({ has: page.locator('input[name="usernameOrEmail"]') }).locator('button[type="submit"]').click();
  try {
    await page.locator('#main-content').waitFor({ state: 'visible', timeout: 15000 });
  } catch (error) {
    if (!(await page.evaluate(() => Boolean(localStorage.getItem('Meteor.loginToken'))))) throw error;
    console.log('INFO: login token received; reload after the application loading timeout');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#main-content').waitFor({ state: 'visible' });
  }
  return page;
}

async function sendAndReceive(sender, recipient, text) {
  const composer = sender.locator('textarea.js-input-message,[contenteditable="true"].js-input-message');
  await composer.fill(text);
  await composer.press('Enter');
  await recipient.locator('[data-mid]').getByText(text, { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const admin = await login(browser, env.ADMIN_USERNAME, env.ADMIN_PASS);
    console.log('PASS: administrator logs into web interface');
    await admin.screenshot({ path: path.join(state, 'admin.png'), fullPage: true });
    const alice = await login(browser, fixture.users[0].username, fixture.users[0].password);
    const bob = await login(browser, fixture.users[1].username, fixture.users[1].password);
    const room = base + '/channel/' + fixture.channel_name;
    await Promise.all([alice.goto(room), bob.goto(room)]);
    // A recipient sees each new message without a navigation or reload.
    const id = Date.now();
    await sendAndReceive(alice, bob, 'Browser realtime channel ' + id);
    await sendAndReceive(bob, alice, 'Browser realtime reply ' + id);
    console.log('PASS: two isolated browser sessions exchange channel messages in realtime');
    await bob.screenshot({ path: path.join(state, 'channel.png'), fullPage: true });
    await Promise.all([
      alice.goto(base + '/direct/' + fixture.users[1].username),
      bob.goto(base + '/direct/' + fixture.users[0].username),
    ]);
    await sendAndReceive(alice, bob, 'Browser realtime direct ' + id);
    await sendAndReceive(bob, alice, 'Browser direct reply ' + id);
    console.log('PASS: two isolated browser sessions exchange direct messages in realtime');
    await bob.screenshot({ path: path.join(state, 'direct.png'), fullPage: true });
    assert.notEqual(alice.context(), bob.context());
    fs.writeFileSync(path.join(state, 'browser-report.json'), JSON.stringify({
      checked_at: new Date().toISOString(), browser: await browser.version(),
      admin_login: 'pass', channel_realtime: 'pass', direct_realtime: 'pass',
    }, null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    for (const [index, context] of browser.contexts().entries()) {
      const page = context.pages()[0];
      if (page) {
        await page.screenshot({ path: path.join(state, `failure-${index}.png`), fullPage: true }).catch(() => {});
        fs.writeFileSync(path.join(state, `failure-${index}.txt`), await page.locator('body').innerText().catch(() => ''), { mode: 0o600 });
      }
    }
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
