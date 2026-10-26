const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIP, locationFor, publicSession } = require('../domain.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('private, loopback, mapped IPv4 and IPv6 local addresses do not get geolocated', () => {
  const reader = { get() { throw new Error('Local addresses must not be looked up'); } };
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.18.0.1', '192.168.1.2', '::1', 'fe80::1', 'fc00::1', '::ffff:192.168.1.1']) {
    assert.equal(locationFor(ip, reader).kind, 'local');
  }
  assert.equal(normalizeIP('::ffff:8.8.8.8'), '8.8.8.8');
});

test('unknown addresses and missing database entries do not invent a city', () => {
  for (const ip of ['', null, 'invalid', '<script>']) assert.equal(locationFor(ip, null).kind, 'unknown');
  assert.equal(locationFor('8.8.8.8', { get: () => null }).kind, 'unknown');
});

test('public IP lookup uses localized city and country names', () => {
  const result = locationFor('8.8.8.8', { get: () => ({ city: { names: { ru: 'Москва', en: 'Moscow' } }, country: { names: { ru: 'Россия' } } }) });
  assert.deepEqual(result, { kind: 'approximate', city: 'Москва', country: 'Россия' });
});

test('session response never exposes authentication material or another user object', () => {
  const token = { hashedToken: 'secret-hash', when: new Date() };
  const result = publicSession(token, { ip: '127.0.0.1', loginToken: 'secret', userId: 'private-id' }, token.hashedToken, null);
  assert.equal(result.current, true);
  assert.equal(result.location.kind, 'local');
  assert.equal(result.id.length, 64);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(!JSON.stringify(result).includes('private-id'));
});

const database = path.join(__dirname, '../data/city.mmdb');
test('pinned offline snapshot returns real city data for public IPs', { skip: !fs.existsSync(database) }, () => {
  const { Reader } = require('maxmind');
  const reader = new Reader(fs.readFileSync(database));
  for (const ip of ['8.8.8.8', '1.1.1.1', '77.88.8.8']) {
    const result = locationFor(ip, reader);
    assert.equal(result.kind, 'approximate');
    assert.ok(result.city);
    assert.ok(result.country);
  }
});
