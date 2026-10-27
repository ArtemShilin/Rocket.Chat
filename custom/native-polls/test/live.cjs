const assert=require('node:assert/strict');
const {setup}=require('./fixture.cjs');
(async()=>{
 const h=await setup();
 try{
  const {api,alice,bob,admin}=h;
  assert.equal((await api('get?pollId=unknown')).status,401);
  const poll=await h.create();
  const ids=poll.options.map(o=>o.id);
  assert.equal((await api('get?pollId='+poll.id,admin)).status,403);
  assert.equal(poll.resultsVisible,false);assert.ok(poll.options.every(o=>o.count===null));
  assert.equal((await api('voters?pollId='+poll.id+'&optionId='+ids[0],alice)).status,403);
  assert.equal((await api('vote',bob,{pollId:poll.id,selections:[ids[0]],userId:alice['X-User-Id']})).status,400);
  const voted=await api('vote',bob,{pollId:poll.id,selections:[ids[0]]});assert.equal(voted.status,200,JSON.stringify(voted.data));
  assert.equal(voted.data.total,1);assert.equal(voted.data.options[0].count,1);
  assert.ok(!JSON.stringify(voted.data).includes(bob['X-User-Id']));
  const hidden=(await api('get?pollId='+poll.id,alice)).data;assert.equal(hidden.resultsVisible,false);assert.ok(hidden.options.every(o=>o.count===null));
  const concurrent=await Promise.all(ids.slice(0,2).map(id=>api('vote',bob,{pollId:poll.id,selections:[id]})));
  for(const result of concurrent)assert.equal(result.status,200,JSON.stringify(result.data));
  const unique=(await api('get?pollId='+poll.id,bob)).data;assert.equal(unique.total,1);assert.equal(unique.options.reduce((n,o)=>n+o.count,0),1);
  assert.equal((await api('vote',bob,{pollId:poll.id,selections:ids.slice(0,2)})).status,400);
  const withdrawn=await api('vote',bob,{pollId:poll.id,selections:[]});assert.equal(withdrawn.status,200);assert.equal(withdrawn.data.total,0);assert.equal(withdrawn.data.resultsVisible,false);
  assert.equal((await api('close',bob,{pollId:poll.id})).status,403);
  assert.equal((await api('close',alice,{pollId:poll.id})).data.closed,true);
  assert.equal((await api('vote',bob,{pollId:poll.id,selections:[ids[0]]})).status,409);
  assert.equal((await api('get?pollId='+poll.id,bob)).data.resultsVisible,true);
  const named=await h.create({anonymous:false,multiple:true,maxSelections:2,results:'always'});
  assert.equal((await api('vote',alice,{pollId:named.id,selections:named.options.slice(0,2).map(o=>o.id)})).status,200);
  const namedVote=await api('vote',bob,{pollId:named.id,selections:[named.options[0].id]});assert.equal(namedVote.data.total,2);assert.equal(namedVote.data.options[0].count,2);assert.equal(namedVote.data.options[1].count,1);
  const people=await api('voters?pollId='+named.id+'&optionId='+named.options[0].id,bob);assert.equal(people.status,200);assert.equal(people.data.users.length,2);
  assert.ok(people.data.users.some(user=>user.username===h.fixture.users[0].username));
  const deadline=await h.create({closesAt:new Date(Date.now()+2000).toISOString()});
  await new Promise(resolve=>setTimeout(resolve,2100));
  assert.equal((await api('vote',bob,{pollId:deadline.id,selections:[deadline.options[0].id]})).status,409);
  for(let n=0;n<3;n++){
   const race=await h.create({results:'always'});
   const [vote,close]=await Promise.all([api('vote',bob,{pollId:race.id,selections:[race.options[0].id]}),api('close',alice,{pollId:race.id})]);
   assert.ok([200,409].includes(vote.status),JSON.stringify(vote));assert.equal(close.status,200);
   const final=(await api('get?pollId='+race.id,bob)).data;assert.equal(final.closed,true);assert.ok(final.total<=1);
   assert.equal((await api('vote',bob,{pollId:race.id,selections:[]})).status,409);
  }
  const deleted=await h.create();
  const removed=await h.request('chat.delete',alice,{roomId:h.group._id,msgId:deleted.messageId,asUser:true});assert.equal(removed.status,200,JSON.stringify(removed.data));
  assert.equal((await api('get?pollId='+deleted.id,bob)).status,404);
  assert.equal((await h.request('groups.kick',alice,{roomId:h.group._id,userId:bob['X-User-Id']})).status,200);
  assert.equal((await api('get?pollId='+named.id,bob)).status,403);
  assert.equal((await api('vote',bob,{pollId:named.id,selections:[named.options[0].id]})).status,403);
  console.log('PASS: Mongo transactions, concurrent votes/closure, anonymous privacy, hidden results, withdrawal, multiple choices, voter names, deadlines, deleted messages and membership revocation.');
 }finally{await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
