const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createReader } = require('../local-ai/core-reader.cjs');
const { HttpError } = require('../local-ai/domain.cjs');
const { validate, visible, writable, canWriteScope } = require('./domain.cjs');

module.exports = ({ Meteor, Accounts, WebApp, WebAppInternals, MongoInternals, core }) => {
  const collection = MongoInternals.defaultRemoteCollectionDriver().mongo.db.collection('rocketchat_local_canned_responses');
  // Do not serve mutations until the uniqueness constraint exists.
  const ready = collection.createIndex({ namespace: 1, shortcut: 1 }, { unique: true });
  ready.catch(error => console.error('[local-canned-responses] Index initialization failed:', error.message));
  const files = new Map(['index.html', 'app.js', 'native.js', 'style.css'].map(name => [name, fs.readFileSync(path.join(__dirname, 'public', name))]));
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
  WebAppInternals.registerBoilerplateDataCallback('local-canned-responses', (request, data) => {
    data.dynamicHead = (data.dynamicHead || '') + '<script defer src="/local-canned-responses/native.js"></script>';
    return true;
  });
  async function read(req) {
    const parts = []; let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > 65536) throw new HttpError(413, 'Запрос слишком большой.');
      parts.push(part);
    }
    try { return JSON.parse(Buffer.concat(parts).toString()); } catch { throw new HttpError(400, 'Некорректный JSON.'); }
  }
  const middleware = (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/local-canned-responses' || url.pathname.startsWith('/local-canned-responses/')) {
      const name = url.pathname.replace(/^\/local-canned-responses\/?/, '') || 'index.html';
      if (!files.has(name)) return json(res, 404, { error: 'Не найдено.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Метод не поддерживается.' });
      const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      return res.end(req.method === 'HEAD' ? undefined : files.get(name));
    }
    if (!url.pathname.startsWith('/api/v1/local-canned-responses/')) return next();
    const action = url.pathname.split('/').pop();
    if (!['list', 'save', 'remove'].includes(action)) return json(res, 404, { error: 'Не найдено.' });
    if (req.method !== (action === 'list' ? 'GET' : 'POST')) return json(res, 405, { error: 'Метод не поддерживается.' });
    (async () => {
      const uid = req.headers['x-user-id']; const token = req.headers['x-auth-token'];
      if (typeof uid !== 'string' || !uid || uid.length > 200 || typeof token !== 'string' || !token || token.length > 512) throw new HttpError(401, 'Войдите в Rocket.Chat.');
      await createReader({ core, Accounts }, uid, token).authorize();
      const user = await core.Users.findOneById(uid);
      const admin = user?.roles?.includes('admin') === true;
      await ready;
      if (action === 'list') {
        const offset = Number(url.searchParams.get('offset') || 0);
        const q = url.searchParams.get('q') || '';
        if (!Number.isSafeInteger(offset) || offset < 0 || q.length > 100 || [...url.searchParams.keys()].some(key => !['offset', 'q'].includes(key))) throw new HttpError(400, 'Некорректный поиск.');
        const filter = visible(uid);
        if (q) {
          const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filter.$and = [{ $or: [{ shortcut: { $regex: pattern, $options: 'i' } }, { text: { $regex: pattern, $options: 'i' } }] }];
        }
        const records = await collection.find(filter, { projection: { namespace: 0 } }).sort({ shortcut: 1, _id: 1 }).skip(offset).limit(51).toArray();
        return json(res, 200, { success: true, admin, items: records.slice(0, 50).map(item => ({ ...item, editable: item.scope === 'shared' ? admin : item.owner === uid })), nextOffset: records.length > 50 ? offset + 50 : null });
      }
      if (url.search) throw new HttpError(400, 'Параметры URL не поддерживаются.');
      const input = validate(await read(req), action === 'remove');
      const filter = { _id: input.id, revision: input.revision, ...writable(uid, admin) };
      if (action === 'remove') {
        const result = await collection.deleteOne(filter);
        if (!result.deletedCount) throw new HttpError(409, 'Шаблон изменён или недоступен. Обновите список.');
      } else {
        canWriteScope(input.scope, admin);
        const fields = { shortcut: input.shortcut, text: input.text, scope: input.scope, namespace: input.scope === 'shared' ? 'shared' : 'personal:' + uid, updatedAt: new Date() };
        if (input.id) {
          // Ownership never transfers, and scope changes require creating another template.
          const result = await collection.updateOne({ ...filter, scope: input.scope }, { $set: fields, $inc: { revision: 1 } });
          if (!result.modifiedCount) throw new HttpError(409, 'Шаблон изменён или недоступен. Обновите список.');
        } else await collection.insertOne({ _id: randomUUID(), ...fields, owner: uid, revision: 1 });
      }
      json(res, 200, { success: true });
    })().catch(error => {
      if (!res.headersSent) json(res, error.code === 11000 ? 409 : error.status || 503, { error: error.code === 11000 ? 'Такое название уже существует в этой области доступа.' : error.status ? error.message : 'Шаблоны временно недоступны.' });
      if (!error.status && error.code !== 11000) console.error('[local-canned-responses]', error.message);
    });
  };
  WebApp.rawConnectHandlers.use(middleware);
  const stack = WebApp.rawConnectHandlers.router.stack;
  const index = stack.findIndex(layer => layer.handle === middleware);
  const [layer] = stack.splice(index, 1); stack.unshift(layer);
};
