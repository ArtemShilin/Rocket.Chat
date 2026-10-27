const http = require('node:http');
const { Readable } = require('node:stream');
const register = require('../server.cjs');
// Exercise HTTP routing and authorization against a small in-memory Mongo adapter.
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(item => matches(row, item));
    if (key === '$and') return value.every(item => matches(row, item));
    if (value && typeof value === 'object' && '$regex' in value) return new RegExp(value.$regex, value.$options).test(row[key]);
    return row[key] === value;
  });
}
async function harness(listen = false) {
  const rows = [];
  const users = Object.fromEntries(['alice', 'bob', 'admin'].map(id => [id, { _id: id, username: id, roles: id === 'admin' ? ['admin'] : ['user'], services: { resume: { loginTokens: [{ hashedToken: id + '-token', when: new Date() }] } } }]));
  const db = {
    async createIndex() {},
    find(filter) {
      let values = rows.filter(row => matches(row, filter)).map(({ namespace, ...rest }) => ({ ...rest }));
      return { sort() { values.sort((a,b) => a.shortcut.localeCompare(b.shortcut) || a._id.localeCompare(b._id)); return this; }, skip(n) { values = values.slice(n); return this; }, limit(n) { values = values.slice(0,n); return this; }, async toArray() { return values; } };
    },
    async insertOne(row) {
      if (rows.some(item => item.namespace === row.namespace && item.shortcut === row.shortcut)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      rows.push(row);
    },
    async updateOne(filter, update) {
      const row = rows.find(item => matches(item, filter)); if (!row) return { modifiedCount: 0 };
      if (rows.some(item => item !== row && item.namespace === update.$set.namespace && item.shortcut === update.$set.shortcut)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      Object.assign(row, update.$set); row.revision++; return { modifiedCount: 1 };
    },
    async deleteOne(filter) { const index = rows.findIndex(item => matches(item, filter)); if (index < 0) return { deletedCount: 0 }; rows.splice(index, 1); return { deletedCount: 1 }; },
  };
  let middleware;
  const WebApp = { rawConnectHandlers: { use(fn) { middleware = fn; this.router.stack.push({ handle: fn }); }, router: { stack: [] } } };
  register({ Meteor: {}, Accounts: { _hashLoginToken: token => token, _tokenExpiration: () => new Date(Date.now() + 86400000) }, WebApp, WebAppInternals: { registerBoilerplateDataCallback() {} }, MongoInternals: { defaultRemoteCollectionDriver: () => ({ mongo: { db: { collection: () => db } } }) }, core: { Users: { findOneById: async id => users[id] } } });
  const server = http.createServer((req,res) => middleware(req,res,() => { res.writeHead(404); res.end(); }));
  if (listen) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = listen ? 'http://127.0.0.1:' + server.address().port : null;
  function dispatch(url, method = 'GET', headers = {}, body) {
    return new Promise((resolve, reject) => {
      const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
      Object.assign(req, { url, method, headers });
      const res = { headersSent: false, writeHead(status, responseHeaders) { this.headersSent = true; this.status = status; this.headers = responseHeaders || {}; }, end(value) { resolve({ status: this.status, headers: this.headers, text: value?.toString() || '' }); } };
      try { middleware(req, res, () => { res.writeHead(404); res.end(); }); } catch (error) { reject(error); }
    });
  }
  async function api(action, uid, body, method) {
    const response = await dispatch('/api/v1/local-canned-responses/' + action, method || (body === undefined ? 'GET' : 'POST'), { 'content-type': 'application/json', ...(uid ? { 'x-user-id': uid, 'x-auth-token': uid + '-token' } : {}) }, body);
    return { status: response.status, data: JSON.parse(response.text) };
  }
  return { rows, users, server, base, api, dispatch, close: () => listen ? new Promise(resolve => server.close(resolve)) : Promise.resolve() };
}
module.exports = { harness };
