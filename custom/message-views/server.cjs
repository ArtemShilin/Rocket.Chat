const fs = require('node:fs');
const path = require('node:path');
const { createReader } = require('../local-ai/core-reader.cjs');
const { HttpError } = require('../local-ai/domain.cjs');
const { createService } = require('./service.cjs');

module.exports = ({ Accounts, WebApp, WebAppInternals, MongoInternals, core }) => {
  const collection = MongoInternals.defaultRemoteCollectionDriver().mongo.db.collection('rocketchat_local_message_views');
  const ready = Promise.all([
    collection.createIndex({ messageId: 1, version: 1, userId: 1 }, { unique: true }),
    collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  ready.catch(error => console.error('[message-views] Initialization:', error.message));
  const files = new Map(['native.js', 'style.css'].map(name => [name, fs.readFileSync(path.join(__dirname, 'public', name))]));
  WebAppInternals.registerBoilerplateDataCallback('local-message-views', (request, data) => {
    data.dynamicHead = (data.dynamicHead || '') + '<link rel="stylesheet" href="/message-views/style.css"><script defer src="/message-views/native.js"></script>';
    return true;
  });
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  async function read(req) {
    const parts = []; let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > 4096) throw new HttpError(413, 'Запрос слишком большой.');
      parts.push(part);
    }
    try { return JSON.parse(Buffer.concat(parts).toString()); } catch { throw new HttpError(400, 'Некорректный JSON.'); }
  }
  const middleware = (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/message-views/')) {
      const name = url.pathname.slice('/message-views/'.length);
      if (!files.has(name)) return json(res, 404, { error: 'Не найдено.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Метод не поддерживается.' });
      res.writeHead(200, { 'Content-Type': name.endsWith('js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : files.get(name));
    }
    if (!url.pathname.startsWith('/api/v1/message-views/')) return next();
    const action = url.pathname.slice('/api/v1/message-views/'.length);
    if (!['inspect', 'acknowledge'].includes(action)) return json(res, 404, { error: 'Не найдено.' });
    if (req.method !== (action === 'inspect' ? 'GET' : 'POST')) return json(res, 405, { error: 'Метод не поддерживается.' });
    (async () => {
      const uid = req.headers['x-user-id']; const token = req.headers['x-auth-token'];
      if (typeof uid !== 'string' || !uid || uid.length > 200 || typeof token !== 'string' || !token || token.length > 512) throw new HttpError(401, 'Войдите в Rocket.Chat.');
      const reader = createReader({ core, Accounts }, uid, token);
      await reader.authorize(); await ready;
      const service = createService({ collection, core, reader, uid });
      if (action === 'inspect') {
        if ([...url.searchParams.keys()].some(key => !['messageId', 'offset'].includes(key))) throw new HttpError(400, 'Неизвестный параметр.');
        return json(res, 200, await service.inspect({ messageId: url.searchParams.get('messageId') }, Number(url.searchParams.get('offset') || 0)));
      }
      if (url.search) throw new HttpError(400, 'Параметры URL не поддерживаются.');
      json(res, 200, await service.acknowledge(await read(req)));
    })().catch(error => {
      if (!res.headersSent) json(res, error.status || 503, { error: error.status ? error.message : 'Подтверждения временно недоступны.' });
      if (!error.status) console.error('[message-views]', error.message);
    });
  };
  WebApp.rawConnectHandlers.use(middleware);
  const stack = WebApp.rawConnectHandlers.router.stack;
  const index = stack.findIndex(layer => layer.handle === middleware);
  const [layer] = stack.splice(index, 1); stack.unshift(layer);
};
