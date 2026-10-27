const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {setup,local}=require('./fixture.cjs');
const {chromium}=require(require.resolve('playwright-core',{paths:[path.join(local,'.state/browser')]}));
(async()=>{
 const h=await setup();let browser;
 try{
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  async function pageFor(auth){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(a=>{localStorage.setItem('Meteor.userId',a['X-User-Id']);localStorage.setItem('Meteor.loginToken',a['X-Auth-Token']);},auth);const page=await context.newPage();page.setDefaultTimeout(60000);await page.goto(h.base+'/group/'+h.group.name);await page.locator('textarea.js-input-message,[contenteditable="true"].js-input-message').waitFor();return page;}
  const alice=await pageFor(h.alice);
  await alice.locator('textarea.js-input-message').fill('Мой незавершённый текст');
  await alice.getByRole('button',{name:'Создать опрос',exact:true}).click();
  const dialog=alice.locator('dialog.np-dialog');await dialog.getByLabel('Вопрос',{exact:true}).fill('Когда проведём встречу?');
  await dialog.getByLabel('Описание',{exact:true}).fill('Выбираем удобный день вместе.');
  await dialog.getByLabel('Вариант 1',{exact:true}).fill('Во вторник');await dialog.getByLabel('Вариант 2',{exact:true}).fill('В четверг');
  assert.equal(await dialog.getByLabel('Комната',{exact:true}).inputValue(),h.group._id);
  const response=alice.waitForResponse(r=>r.url().endsWith('/native-polls/create'));
  await dialog.getByRole('button',{name:'Опубликовать опрос',exact:true}).click();
  const published=await response;assert.equal(published.status(),200);const poll=await published.json();h.track(poll.id);
  await dialog.getByText('Опрос опубликован в переписке.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  assert.equal(await alice.locator('textarea.js-input-message').inputValue(),'Мой незавершённый текст');
  console.log('PASS: create form publishes to the selected room and preserves the draft');
  const aliceCard=alice.locator('[data-poll-id="'+poll.id+'"]');await aliceCard.getByRole('heading',{name:poll.question}).waitFor();
  const bob=await pageFor(h.bob);const bobCard=bob.locator('[data-poll-id="'+poll.id+'"]');await bobCard.getByRole('heading',{name:poll.question}).waitFor();
  console.log('PASS: native poll cards visible to both participants');
  await bob.getByRole('button',{name:'Создать опрос',exact:true}).click();await bob.locator('dialog.np-dialog').getByLabel('Вопрос',{exact:true}).waitFor();await bob.locator('dialog.np-dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  assert.equal(await bobCard.locator('.np-count').count(),0);
  await bobCard.getByLabel('Во вторник',{exact:true}).check();await bobCard.getByRole('button',{name:'Проголосовать',exact:true}).click();
  await bobCard.getByRole('status').filter({hasText:'Голос учтён'}).waitFor();
  assert.equal(await bobCard.getByRole('button',{name:'Кто выбрал',exact:true}).count(),0);
  await bob.reload();await bobCard.getByLabel('Во вторник',{exact:true}).waitFor();assert.equal(await bobCard.getByLabel('Во вторник',{exact:true}).isChecked(),true);
  await aliceCard.getByLabel('В четверг',{exact:true}).check();await aliceCard.getByRole('button',{name:'Проголосовать',exact:true}).click();await aliceCard.getByRole('status').filter({hasText:'Голос учтён'}).waitFor();
  assert.deepEqual(await aliceCard.locator('.np-count').allTextContents(),['50% · 1','50% · 1']);
  await bobCard.getByLabel('В четверг',{exact:true}).check();await bobCard.getByRole('button',{name:'Сохранить выбор',exact:true}).click();await bobCard.getByRole('status').filter({hasText:'Голос учтён'}).waitFor();
  await aliceCard.getByRole('button',{name:'Обновить',exact:true}).click();await aliceCard.locator('.np-count').filter({hasText:'100% · 2'}).waitFor();
  await bobCard.getByRole('button',{name:'Отозвать голос',exact:true}).click();await bobCard.getByRole('status').filter({hasText:'Голос отозван'}).waitFor();
  await aliceCard.getByRole('button',{name:'Завершить',exact:true}).click();await aliceCard.getByRole('button',{name:'Завершить опрос',exact:true}).click();await aliceCard.getByText('Голосование завершено',{exact:true}).waitFor();
  const multi=await h.create({question:'Выберите до двух направлений',multiple:true,maxSelections:2,anonymous:false,results:'always',options:['Разработка','Дизайн','Аналитика']});
  await bob.goto(h.base+'/polls/'+multi.id);const multiCard=bob.locator('.np-card');await multiCard.getByLabel('Разработка',{exact:true}).check();await multiCard.getByLabel('Дизайн',{exact:true}).check();await multiCard.getByLabel('Аналитика',{exact:true}).click();assert.equal(await multiCard.getByLabel('Аналитика',{exact:true}).isChecked(),false);
  await multiCard.getByRole('button',{name:'Проголосовать',exact:true}).click();await multiCard.getByRole('status').filter({hasText:'Голос учтён'}).waitFor();
  await multiCard.getByRole('button',{name:'Кто выбрал',exact:true}).first().click();await multiCard.locator('.np-voters').getByText(h.fixture.users[1].username,{exact:false}).waitFor();
  await bob.setViewportSize({width:390,height:844});assert.equal(await bob.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await bob.screenshot({path:path.join(local,'.state/native-polls-mobile.png'),fullPage:true});
  await bob.emulateMedia({colorScheme:'dark'});await bob.screenshot({path:path.join(local,'.state/native-polls-dark.png'),fullPage:true});
  await alice.screenshot({path:path.join(local,'.state/native-polls-chat.png'),fullPage:true});
  await bob.evaluate(a=>{localStorage.setItem('Meteor.userId',a['X-User-Id']);localStorage.setItem('Meteor.loginToken',a['X-Auth-Token']);window.dispatchEvent(new StorageEvent('storage',{key:'Meteor.userId'}));},h.admin);
  assert.equal(await bob.locator('.np-question').count(),0);
  await alice.locator('textarea.js-input-message').fill('');
  console.log('PASS: native create form, chat cards, draft preservation, two-user voting, saved choices, changing/withdrawing votes, hidden/anonymous results, closure, multiple choices, voter names, mobile/dark UI and account switching.');
 }catch(error){if(browser)for(const [n,context]of browser.contexts().entries()){const page=context.pages()[0];if(page){await page.screenshot({path:path.join(local,`.state/native-polls-failure-${n}.png`),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(local,`.state/native-polls-failure-${n}.txt`),await page.locator('body').innerText().catch(()=>''),{mode:0o600});}}throw error;}
 finally{await browser?.close();await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
