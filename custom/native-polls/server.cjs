const fs = require('node:fs');
const path = require('node:path');
const { createReader } = require('../local-ai/core-reader.cjs');
const { HttpError } = require('../local-ai/domain.cjs');
const { createService } = require('./service.cjs');

module.exports = ({ Accounts, WebApp, WebAppInternals, MongoInternals, core, sendMessage }) => {
  const db = MongoInternals.defaultRemoteCollectionDriver().mongo.db;
  const polls = db.collection('rocketchat_native_polls'); const ballots = db.collection('rocketchat_native_poll_ballots');
  const ready = Promise.all([
    polls.createIndex({ roomId: 1, createdAt: -1 }),
    ballots.createIndex({ pollId: 1, userId: 1 }, { unique: true }),
    ballots.createIndex({ pollId: 1, selections: 1, userId: 1 }),
  ]);
  ready.catch(error => console.error('[native-polls] Initialization:', error.message));
  const files = new Map(['index.html', 'app.js', 'style.css'].map(name => [name, fs.readFileSync(path.join(__dirname, 'public', name))]));
  WebAppInternals.registerBoilerplateDataCallback('native-polls', (request, data) => {
    data.dynamicHead = (data.dynamicHead || '') + '<link rel="stylesheet" href="/native-polls/style.css"><script defer src="/native-polls/app.js"></script>';
    return true;
  });
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body));
  };
  async function read(req) {
    const parts = []; let bytes = 0;
    for await (const part of req) { bytes += part.length; if (bytes > 32768) throw new HttpError(413, 'Запрос слишком большой.'); parts.push(part); }
    try { return JSON.parse(Buffer.concat(parts).toString()); } catch { throw new HttpError(400, 'Некорректный JSON.'); }
  }
  const middleware = (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    let asset;
    if (/^\/polls\/[\w-]{1,200}\/?$/.test(url.pathname)) asset = 'index.html';
    else if (url.pathname.startsWith('/native-polls/')) asset = url.pathname.slice('/native-polls/'.length);
    if (asset) {
      if (!files.has(asset)) return json(res, 404, { error: 'Не найдено.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Метод не поддерживается.' });
      const type = asset.endsWith('js') ? 'text/javascript' : asset.endsWith('css') ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      return res.end(req.method === 'HEAD' ? undefined : files.get(asset));
    }
    if (!url.pathname.startsWith('/api/v1/native-polls/')) return next();
    const action = url.pathname.slice('/api/v1/native-polls/'.length);
    if (!['rooms', 'get', 'voters', 'create', 'vote', 'close'].includes(action)) return json(res, 404, { error: 'Не найдено.' });
    const mutation = ['create', 'vote', 'close'].includes(action);
    if (req.method !== (mutation ? 'POST' : 'GET')) return json(res, 405, { error: 'Метод не поддерживается.' });
    (async () => {
      const uid = req.headers['x-user-id']; const token = req.headers['x-auth-token'];
      if (typeof uid !== 'string' || !uid || uid.length > 200 || typeof token !== 'string' || !token || token.length > 512) throw new HttpError(401, 'Войдите в Rocket.Chat.');
      const reader = createReader({ core, Accounts }, uid, token); await reader.authorize(); await ready;
      const allowed = action === 'get' ? ['pollId'] : action === 'voters' ? ['pollId', 'optionId', 'offset'] : [];
      if ([...url.searchParams.keys()].some(key => !allowed.includes(key))) throw new HttpError(400, 'Неизвестный параметр.');
      if (action === 'rooms') return json(res, 200, { success: true, rooms: await reader.rooms() });
      const user = await core.Users.findOneById(uid);
      const service = createService({ polls, ballots, client: db.client, core, reader, uid, admin: user.roles?.includes('admin') === true,
        publish: async (id, input) => {
          const title = input.question.replace(/[\\`*_\[\]<>]/g, '\\$&');
          try { return await sendMessage(uid, { _id: 'np_' + id, rid: input.roomId, parseUrls: false, msg: '📊 **' + title + '**\n' + (process.env.ROOT_URL || 'http://localhost:3000').replace(/\/$/, '') + '/polls/' + id }); }
          catch (error) { console.error('[native-polls] Publish:', error.message); throw new HttpError(403, 'Не удалось отправить опрос. Проверьте право отправки сообщений в эту комнату.'); }
        },
      });
      const result = action === 'get' ? await service.get(url.searchParams.get('pollId'))
        : action === 'voters' ? await service.voters(url.searchParams.get('pollId'), url.searchParams.get('optionId'), Number(url.searchParams.get('offset') || 0))
          : await service[action](await read(req));
      json(res, 200, { success: true, ...result });
    })().catch(error => {
      if (!res.headersSent) json(res, error.status || 503, { error: error.status ? error.message : 'Опросы временно недоступны. Повторите попытку.' });
      if (!error.status) console.error('[native-polls]', error.message);
    });
  };
  WebApp.rawConnectHandlers.use(middleware);
  const stack = WebApp.rawConnectHandlers.router.stack;
  const index = stack.findIndex(layer => layer.handle === middleware);
  const [layer] = stack.splice(index, 1); stack.unshift(layer);
};
