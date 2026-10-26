const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validTokens, aggregateQuery } = require('../domain.cjs');
test('only valid interactive sessions can be revoked', () => {
  const Accounts = { _tokenExpiration: when => new Date(+when + 1000) }; const now = new Date();
  const user = { services: { resume: { loginTokens: [{ hashedToken: 'valid', when: now }, { hashedToken: 'expired', when: new Date(0) }, { hashedToken: 'pat', when: now, name: 'API' }, { hashedToken: 'missing-date' }] } } };
  assert.deepEqual(validTokens(user, Accounts).map(token => token.hashedToken), ['valid']);
});
test('user search escapes regex syntax and pagination happens before returning rows', () => {
  const pipeline = aggregateQuery('user.*[a]', new Date(0), 100, 25);
  assert.equal(pipeline[0].$match.username.$regex, 'user\\.\\*\\[a\\]');
  assert.deepEqual(pipeline.at(-1).$facet.rows, [{ $skip: 100 }, { $limit: 25 }]);
  assert.ok(pipeline.some(stage => stage.$match?.['token.hashedToken']));
});
