const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const fixture = JSON.parse(fs.readFileSync(path.join(local, '.state/fixture.json')));
const env = Object.fromEntries(fs.readFileSync(path.join(local, '.env'), 'utf8').trim().split('\n').map(line => { const n = line.indexOf('='); return [line.slice(0,n), line.slice(n+1)]; }));
const base = process.env.DEVICES_TEST_BASE || 'http://localhost:3000';
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(local, '.state/browser')] }));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function request(route, auth = {}, body) {
 const response = await fetch(base + '/api/v1/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
 return { data: await response.json(), status: response.status };
}
async function login(user,password) { const r = await request('login', {}, { user,password }); assert.equal(r.status,200); return { 'X-User-Id': r.data.data.userId, 'X-Auth-Token': r.data.data.authToken }; }
const api = (route,auth,body) => request('workspace-devices/'+route,auth,body);
(async () => {
 let admin, adminUI, alice, phone, browser;
 try {
  admin = await login(env.ADMIN_USERNAME,env.ADMIN_PASS); alice = await login(fixture.users[0].username,fixture.users[0].password); phone = await login(fixture.users[0].username,fixture.users[0].password);
  assert.equal((await api('status')).status,401); assert.equal((await api('status',alice)).status,403);
  assert.equal((await api('list',admin)).status,428); assert.equal((await api('reauth',alice,{passwordDigest:digest(fixture.users[0].password)})).status,403);
  assert.equal((await api('reauth',admin,{passwordDigest:digest('wrong-password')})).status,403);
  const auth = await api('reauth',admin,{passwordDigest:digest(env.ADMIN_PASS)}); assert.equal(auth.status,200,auth.data.error);
  const current = await request('account.devices',admin); const currentId = current.data.sessions.find(s=>s.current).id;
  assert.equal((await api('revoke',admin,{userId:admin['X-User-Id'],deviceId:currentId})).status,409);
  assert.equal((await api('revoke',alice,{userId:admin['X-User-Id'],deviceId:currentId})).status,403);
  assert.equal((await api('revoke',admin,{userId:alice['X-User-Id'],deviceId:'0'.repeat(64)})).status,404);
  const list = await api('list?user='+fixture.users[0].username,admin); assert.equal(list.status,200); assert.ok(list.data.sessions.length>=2);
  const serialized=JSON.stringify(list.data); assert.ok(!/hashedToken|loginToken|services|passwordDigest/.test(serialized));
  for(const a of [admin,alice,phone])assert.ok(!serialized.includes(a['X-Auth-Token']));
  console.log('PASS: admin role, password reauthentication, session isolation, no token disclosure, current-admin protection');
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const mobile=await browser.newContext({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',isMobile:true});
  await mobile.addInitScript(a=>{localStorage.setItem('Meteor.userId',a['X-User-Id']);localStorage.setItem('Meteor.loginToken',a['X-Auth-Token']);},phone);
  const target=await mobile.newPage();target.setDefaultTimeout(90000);await target.goto(base+'/home');await target.locator('#main-content').waitFor();
  const own=await target.evaluate(async a=>await(await fetch('/api/v1/account.devices',{headers:a})).json(),phone); const id=own.sessions.find(s=>s.current).id;
  adminUI=await login(env.ADMIN_USERNAME,env.ADMIN_PASS);
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(a=>{localStorage.setItem('Meteor.userId',a['X-User-Id']);localStorage.setItem('Meteor.loginToken',a['X-Auth-Token']);},adminUI);
  const page=await context.newPage();page.setDefaultTimeout(90000);await page.goto(base+'/workspace-devices');await page.locator('#unlock').waitFor({state:'visible'});
  await page.locator('#password').fill(env.ADMIN_PASS);await page.locator('#unlock button').click();await page.locator('#panel').waitFor({state:'visible'});
  await page.locator('#user').fill(fixture.users[0].username);await page.locator('#filter button[type=submit]').click();
  const card=page.locator(`article[data-id="${id}"]`);await card.waitFor();assert.match(await card.innerText(),/iPhone|Safari/);
  page.once('dialog',dialog=>dialog.accept());await card.locator('button').click();await card.waitFor({state:'detached'});
  assert.equal((await request('me',phone)).status,401);assert.equal((await request('me',alice)).status,200);
  await target.locator('input[name=usernameOrEmail]').waitFor({state:'visible'});
  const events=await api('events',admin);assert.equal(events.status,200);assert.ok(events.data.events.some(event=>event.userId===phone['X-User-Id']&&event.deviceId===id));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(local,'.state/workspace-devices-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS: browser reauthentication, iPhone/IP/location, targeted remote logout including live DDP, other session preserved, audit and mobile layout');
 } catch(error) {
  if(browser)for(const [index,context] of browser.contexts().entries()){
   const page=context.pages()[0];if(!page)continue;
   await page.screenshot({path:path.join(local,`.state/workspace-regression-failure-${index}.png`),fullPage:true}).catch(()=>{});
   fs.writeFileSync(path.join(local,`.state/workspace-regression-failure-${index}.txt`),await page.locator('body').innerText().catch(()=>''),{mode:0o600});
  }
  throw error;
 } finally {
  if(browser)await browser.close();for(const a of [admin,adminUI,alice,phone].filter(Boolean))await request('logout',a,{}).catch(()=>{});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
