const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(local, '.state/browser')] }));
const fixture = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json')));
const base = 'http://localhost:3000';
const phoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

async function login(browser, user, mobile = false) {
  const context = await browser.newContext(mobile ? {
    viewport: { width: 390, height: 844 }, userAgent: phoneUA, isMobile: true, locale: 'en-US',
  } : { viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(base);
  await page.locator('input[name="usernameOrEmail"]').fill(user.username);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await page.locator('#main-content').waitFor();
  if (!mobile) assert.ok(await page.getByRole('link', { name: /Мои устройства/ }).count(), 'Sidebar link is missing');
  await page.goto(base + '/my-devices');
  await page.locator('tr[data-current="true"]').waitFor();
  return page;
}

async function api(page, query = '', authOverride = null) {
  return page.evaluate(async ({ query, authOverride }) => {
    const headers = authOverride || {
      'X-User-Id': localStorage.getItem('Meteor.userId'),
      'X-Auth-Token': localStorage.getItem('Meteor.loginToken'),
    };
    const response = await fetch('/api/v1/account.devices' + query, { headers });
    return { status: response.status, data: await response.json() };
  }, { query, authOverride });
}

async function logout(page) {
  await page.evaluate(async () => {
    await fetch('/api/v1/logout', { method: 'POST', headers: {
      'X-User-Id': localStorage.getItem('Meteor.userId'),
      'X-Auth-Token': localStorage.getItem('Meteor.loginToken'), 'Content-Type': 'application/json',
    }, body: '{}' });
  });
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  let alice; let phone; let bob;
  try {
    alice = await login(browser, fixture.users[0]);
    phone = await login(browser, fixture.users[0], true);
    bob = await login(browser, fixture.users[1]);
    await alice.getByRole('button', { name: 'Обновить список' }).click();
    await alice.getByText('Apple iPhone', { exact: true }).first().waitFor();
    assert.match(await phone.locator('tr[data-current="true"]').innerText(), /iPhone/);
    assert.match(await alice.locator('tr[data-current="true"]').innerText(), /Локальная сеть/);
    const own = await api(alice);
    const other = await api(bob);
    const mobile = await api(phone);
    assert.equal(own.status, 200);
    assert.equal(other.status, 200);
    const mobileId = mobile.data.sessions.find(item => item.current).id;
    assert.ok(own.data.sessions.some(item => item.id === mobileId));
    assert.ok(!other.data.sessions.some(item => item.id === mobileId));
    assert.ok(!JSON.stringify(own.data).match(/hashedToken|loginToken|tokenHash/));
    assert.equal(own.data.sessions.filter(item => item.current).length, 1);
    assert.equal((await api(alice, '?userId=' + fixture.users[1].id)).status, 400);
    assert.equal((await api(alice, '', {})).status, 401);
    assert.equal((await api(alice, '?count=101')).status, 400);
    assert.equal((await api(alice, '?offset=-1')).status, 400);
    const badAuth = await alice.evaluate(uid => ({
      'X-User-Id': uid, 'X-Auth-Token': localStorage.getItem('Meteor.loginToken'),
    }), fixture.users[1].id);
    assert.equal((await api(alice, '', badAuth)).status, 401);
    const forwarded = await alice.evaluate(() => ({
      'X-User-Id': localStorage.getItem('Meteor.userId'),
      'X-Auth-Token': localStorage.getItem('Meteor.loginToken'),
      'X-Forwarded-For': '8.8.8.8', 'X-Real-IP': '8.8.8.8',
    }));
    const withForgedIP = await api(alice, '', forwarded);
    assert.notEqual(withForgedIP.data.sessions.find(item => item.current).ip, '8.8.8.8');
    console.log('PASS: own devices only; anonymous, cross-account and invalid requests rejected');
    console.log('PASS: desktop and iPhone recognized; IP, local location and current-device badge displayed');
    await alice.screenshot({ path: path.join(local, '.state/my-devices.png'), fullPage: true });
    await phone.screenshot({ path: path.join(local, '.state/my-devices-mobile.png'), fullPage: true });
    await logout(phone);
    assert.equal((await api(phone)).status, 401);
    const afterLogout = await api(alice);
    assert.ok(!afterLogout.data.sessions.some(item => item.id === mobileId));
    console.log('PASS: logged-out device disappears and its credentials stop working');
    fs.writeFileSync(path.join(local, '.state/devices-report.json'), JSON.stringify({
      checked_at: new Date().toISOString(), own_devices: 'pass', device_detection: 'pass',
      ip_and_local_city: 'pass', cross_account_isolation: 'pass', anonymous_rejected: 'pass',
      pagination_validation: 'pass', logout_invalidation: 'pass', responsive_ui: 'pass',
    }, null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    for (const [index, context] of browser.contexts().entries()) {
      const page = context.pages()[0];
      if (page) {
        await page.screenshot({ path: path.join(local, `.state/devices-failure-${index}.png`), fullPage: true }).catch(() => {});
        fs.writeFileSync(path.join(local, `.state/devices-failure-${index}.txt`), await page.locator('body').innerText().catch(() => ''));
      }
    }
    throw error;
  } finally {
    for (const page of [alice, phone, bob]) if (page) await logout(page).catch(() => {});
    await browser.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
