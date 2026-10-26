const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestChat } = require('../transport.cjs');

test('standard API rate limits are respected before retrying', async () => {
  let calls = 0; let waited = 0;
  const result = await requestChat('subscriptions.get', undefined, {}, new AbortController().signal, {
    fetchImpl: async () => ++calls === 1
      ? new Response('{}', { status: 429, headers: { 'X-RateLimit-Reset': String(Date.now() + 1000) } })
      : new Response('{"success":true,"update":[]}'),
    waitImpl: async duration => { waited = duration; },
  });
  assert.equal(calls, 2); assert.ok(waited >= 1000); assert.equal(result.success, true);
});

test('permission failures are not retried or turned into successful results', async () => {
  let calls = 0;
  await assert.rejects(requestChat('chat.getMessages', {}, {}, new AbortController().signal, {
    fetchImpl: async () => { calls++; return new Response('{}', { status: 403 }); },
    waitImpl: async () => assert.fail('Must not wait'),
  }), { status: 403 });
  assert.equal(calls, 1);
});
