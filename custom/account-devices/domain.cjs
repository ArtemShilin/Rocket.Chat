const crypto = require('node:crypto');
const ipaddr = require('ipaddr.js');

function normalizeIP(value) {
  if (typeof value !== 'string' || !ipaddr.isValid(value)) return null;
  return ipaddr.process(value).toString();
}

function locationFor(value, reader) {
  const ip = normalizeIP(value);
  if (!ip) return { kind: 'unknown', city: null, country: null };
  const range = ipaddr.parse(ip).range();
  if (range !== 'unicast') return { kind: 'local', city: null, country: null };
  const result = reader?.get(ip);
  if (!result) return { kind: 'unknown', city: null, country: null };
  return {
    kind: 'approximate',
    city: result.city?.names?.ru || result.city?.names?.en || null,
    country: result.country?.names?.ru || result.country?.names?.en || null,
  };
}

function publicSession(token, record, currentHash, reader) {
  const ip = normalizeIP(record?.ip);
  return {
    id: crypto.createHash('sha256').update('account-device:' + token.hashedToken).digest('hex'),
    current: token.hashedToken === currentHash,
    device: record?.device || null,
    ip,
    location: locationFor(ip, reader),
    loginAt: token.when,
    lastActivityAt: record?.lastActivityAt || record?.closedAt || record?.loginAt || null,
  };
}

module.exports = { normalizeIP, locationFor, publicSession };
