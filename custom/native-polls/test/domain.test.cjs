const test = require('node:test');
const assert = require('node:assert/strict');
const { createInput, voteInput, isClosed, resultsVisible } = require('../domain.cjs');
const now = new Date('2026-10-27T10:00:00Z');
const input = () => ({ roomId: 'room1', question: 'Когда встречаемся?', description: '', options: ['Завтра', 'В пятницу'], multiple: false, maxSelections: 1, anonymous: true, results: 'after-vote', closesAt: null });
test('creation normalizes text and assigns immutable option IDs', () => {
  const poll = createInput(input(), now);
  assert.equal(poll.options.length,2); assert.notEqual(poll.options[0].id,poll.options[1].id);
  assert.equal(poll.maxSelections,1); assert.equal(poll.closesAt,null);
});
test('invalid, duplicate, excessive options and impersonation parameters are rejected', () => {
  for (const changes of [{ options: ['one'] }, { options: ['Да',' да '] }, { options: Array.from({length:13},(_,i)=>String(i)) }, { question: 'x'.repeat(241) }, { description: 0 }, { roomId: { $ne: null } }, { creatorId: 'admin' }, { anonymous: 'true' }, { results: 'other' }]) assert.throws(() => createInput({...input(),...changes},now), error => error.status === 400);
});
test('deadlines must be future dates within one year', () => {
  for (const closesAt of ['invalid','2020-01-01T00:00:00Z','2030-01-01T00:00:00Z',123]) assert.throws(()=>createInput({...input(),closesAt},now),error=>error.status===400);
  assert.ok(createInput({...input(),closesAt:'2026-10-28T10:00:00Z'},now).closesAt > now);
});
test('votes enforce option identities and selection limits, withdrawal is supported', () => {
  const poll = createInput(input(), now); const id = poll.options[0].id;
  assert.deepEqual(voteInput({pollId:'x',selections:[id]},poll),[id]);
  assert.deepEqual(voteInput({pollId:'x',selections:[]},poll),[]);
  for(const body of [{pollId:'x',selections:['unknown']},{pollId:'x',selections:[id,id]},{pollId:'x',selections:poll.options.map(o=>o.id)},{pollId:'x',selections:[id],userId:'admin'}]) assert.throws(()=>voteInput(body,poll),error=>error.status===400);
});
test('hidden results depend on voting or closure, including automatic expiry', () => {
  const poll={...createInput(input(),now),status:'open'};
  assert.equal(resultsVisible(poll,[],now),false);assert.equal(resultsVisible(poll,['id'],now),true);
  assert.equal(resultsVisible({...poll,status:'closed'},[],now),true);
  assert.equal(isClosed({...poll,closesAt:new Date(+now-1)},now),true);
  assert.equal(resultsVisible({...poll,closesAt:new Date(+now-1)},[],now),true);
});
