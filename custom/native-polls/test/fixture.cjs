const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../../../deploy/local');
const fixture = JSON.parse(fs.readFileSync(path.join(local,'.state/fixture.json')));
const env = Object.fromEntries(fs.readFileSync(path.join(local,'.env'),'utf8').trim().split('\n').map(line=>{const n=line.indexOf('=');return[line.slice(0,n),line.slice(n+1)];}));
const base = process.env.POLLS_TEST_BASE || 'http://localhost:3001';
async function request(route,auth={},body) {
  const response=await fetch(base+'/api/v1/'+route,{method:body===undefined?'GET':'POST',headers:{...auth,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
}
async function setup() {
  const sessions=[]; const ids=[]; let group;
  async function login(user,password){const result=await request('login',{}, {user,password});assert.equal(result.status,200);const auth={'X-User-Id':result.data.data.userId,'X-Auth-Token':result.data.data.authToken};sessions.push(auth);return auth;}
  const alice=await login(fixture.users[0].username,fixture.users[0].password);
  const bob=await login(fixture.users[1].username,fixture.users[1].password);
  const admin=await login(env.ADMIN_USERNAME,env.ADMIN_PASS);
  const created=await request('groups.create',alice,{name:'native-polls-check-'+Date.now(),members:[fixture.users[1].username]});assert.equal(created.status,200,created.data.error);group=created.data.group;
  const api=(action,auth,body)=>request('native-polls/'+action,auth,body);
  async function create(changes={}) {
    const result=await api('create',alice,{roomId:group._id,question:'Какой вариант выбираем?',description:'Проверка собственного модуля',options:['Первый','Второй','Третий'],multiple:false,maxSelections:1,anonymous:true,results:'after-vote',closesAt:null,...changes});
    assert.equal(result.status,200,JSON.stringify(result.data)); ids.push(result.data.id);return result.data;
  }
  async function close() {
    const state=path.join(local,'.state/native-polls-test-ids.json');
    let previous=[];try{previous=JSON.parse(fs.readFileSync(state));}catch{}
    fs.writeFileSync(state,JSON.stringify([...previous,...ids.map(id=>({id,roomId:group._id,creatorId:alice['X-User-Id']}))],null,2)+'\n',{mode:0o600});
    const result=await request('groups.delete',alice,{roomId:group._id});assert.equal(result.status,200,result.data.error);
    for(const auth of sessions)await request('logout',auth,{}).catch(()=>{});
  }
  return {alice,bob,admin,group,api,create,close,base,local,fixture,request,track:id=>ids.push(id)};
}
module.exports={setup,base,local,fixture};
