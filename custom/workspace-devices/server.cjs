const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const dependencies = createRequire(path.resolve(__dirname, '../account-devices/package.json'));
const { publicSession, normalizeIP } = require('../account-devices/domain.cjs');
const { createReader } = require('../local-ai/core-reader.cjs');
const { HttpError } = require('../local-ai/domain.cjs');
const { validTokens, aggregateQuery } = require('./domain.cjs');

module.exports = ({ Meteor, Accounts, WebApp, MongoInternals, core, twoFactor, coreServices }) => {
  const geo = new (dependencies('maxmind').Reader)(fs.readFileSync(path.resolve(__dirname, '../account-devices/data/city.mmdb')));
  const db = () => MongoInternals.defaultRemoteCollectionDriver().mongo.db;
  const grants = new Map(); const failures = new Map();
  const files = new Map([
    ['/workspace-devices', ['index.html', 'text/html; charset=utf-8']],
    ...['app.js', 'style.css'].map(name => ['/workspace-devices/' + name, [name, name.endsWith('js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8']]),
  ].map(([url, [name, type]]) => [url, { body: fs.readFileSync(path.join(__dirname, 'public', name)), type }]));
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body));
  };
  const read = req => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', part => { size += part.length; if (size > 4096) { chunks.length = 0; reject(new HttpError(413, 'Запрос слишком большой.')); } else chunks.push(part); });
    req.on('end', () => { if (size > 4096) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new HttpError(400, 'Некорректный JSON.')); } });
    req.on('error', () => reject(new HttpError(400, 'Запрос прерван.')));
  });
  async function admin(req) {
    const uid = req.headers['x-user-id']; const token = req.headers['x-auth-token'];
    if (typeof uid !== 'string' || typeof token !== 'string' || uid.length > 200 || token.length > 512) throw new HttpError(401, 'Войдите в Rocket.Chat.');
    await createReader({ core, Accounts }, uid, token, new AbortController().signal).authorize();
    const user = await core.Users.findOneById(uid);
    if (user?.active === false || !user?.roles?.includes('admin')) throw new HttpError(403, 'Панель доступна только администраторам.');
    return { user, hash: Accounts._hashLoginToken(token), key: uid + ':' + Accounts._hashLoginToken(token) };
  }
  async function metadata(rows) {
    if (!rows.length) return new Map();
    const hashes = rows.map(row => row.token.hashedToken);
    const records = await db().collection('rocketchat_sessions').aggregate([
      { $match: { loginToken: { $in: hashes }, logoutAt: { $exists: false } } }, { $sort: { loginAt: -1 } },
      { $group: { _id: '$loginToken', record: { $first: '$$ROOT' } } },
    ]).toArray();
    const result = new Map(records.map(row => [row._id, row.record]));
    const observations = await db().collection('rocketchat_account_device_observations').find({ tokenHash: { $in: hashes } }).toArray();
    for (const item of observations) result.set(item.tokenHash, item);
    return result;
  }
  const middleware = (req, res, next) => {
    const url = new URL(req.url, 'http://localhost'); const file = files.get(url.pathname);
    if (file) {
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Метод не поддерживается.' });
      res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(req.method === 'HEAD' ? undefined : file.body); return;
    }
    if (!url.pathname.startsWith('/api/v1/workspace-devices/')) return next();
    const action = url.pathname.slice('/api/v1/workspace-devices/'.length);
    if (!['status', 'reauth', 'list', 'revoke', 'events'].includes(action)) return send(res, 404, { error: 'Не найдено.' });
    const method = ['reauth', 'revoke'].includes(action) ? 'POST' : 'GET';
    if (req.method !== method) return send(res, 405, { error: 'Метод не поддерживается.' });
    (async () => {
      const actor = await admin(req);
      const authorized = (grants.get(actor.key) || 0) > Date.now();
      if (action === 'status') return send(res, 200, { success: true, authorized, expiresAt: grants.get(actor.key) || null });
      if (action === 'reauth') {
        const body = await read(req);
        if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['passwordDigest', 'code', 'method'].includes(key)) || typeof body.passwordDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.passwordDigest)) throw new HttpError(400, 'Введите пароль администратора.');
        const fail = failures.get(actor.user._id);
        if (fail?.until > Date.now() && fail.count >= 5) throw new HttpError(429, 'Слишком много попыток. Повторите через минуту.');
        const invalid = () => { const old = failures.get(actor.user._id); failures.set(actor.user._id, { count: old?.until > Date.now() ? old.count + 1 : 1, until: Date.now() + 60000 }); };
        const password = await Accounts._checkPasswordAsync(actor.user, { digest: body.passwordDigest, algorithm: 'sha-256' });
        if (password.error) { invalid(); throw new HttpError(403, 'Неверный пароль.'); }
        const options = { requireSecondFactor: true, disableRememberMe: true };
        let method;
        try { await twoFactor.checkCodeForUser({ user: actor.user._id, options }); }
        catch (error) {
          if (error.error !== 'totp-required') { console.error('[workspace-devices] Factor check:', error.message); invalid(); throw new HttpError(403, 'Не удалось подтвердить второй фактор.'); }
          method = error.details?.method;
          if (!['password', 'totp', 'email'].includes(method)) throw new HttpError(503, 'Не удалось определить способ второго фактора.');
        }
        if (method) {
          if (method !== 'password' && !body.code) return send(res, 428, { error: 'Введите код второго фактора.', method });
          try { await twoFactor.checkCodeForUser({ user: actor.user._id, method, code: method === 'password' ? body.passwordDigest : body.code, options }); }
          catch { invalid(); throw new HttpError(403, 'Код второго фактора не принят.'); }
        }
        failures.delete(actor.user._id);
        for (const [key, until] of grants) if (until < Date.now()) grants.delete(key);
        grants.set(actor.key, Date.now() + 5 * 60000);
        return send(res, 200, { success: true, expiresAt: grants.get(actor.key) });
      }
      if (!authorized) throw new HttpError(428, 'Подтвердите пароль для доступа к устройствам.');
      const offset = Number(url.searchParams.get('offset') || 0); const count = Number(url.searchParams.get('count') || 25);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(count) || count < 1 || count > 100) throw new HttpError(400, 'Некорректная страница.');
      if (action === 'list') {
        const filter = url.searchParams.get('user') || '';
        if (filter.length > 200 || [...url.searchParams.keys()].some(key => !['offset', 'count', 'user'].includes(key))) throw new HttpError(400, 'Некорректный фильтр.');
        const lifetime = Number(Accounts._tokenExpiration(new Date(0)));
        const [result] = await db().collection('users').aggregate(aggregateQuery(filter, new Date(Date.now() - lifetime), offset, count)).toArray();
        const rows = result?.rows || []; const records = await metadata(rows);
        const sessions = rows.map(row => ({ ...publicSession(row.token, records.get(row.token.hashedToken), actor.hash, geo), userId: row._id, username: row.username, name: row.name || row.username }));
        return send(res, 200, { success: true, sessions, total: result?.total[0]?.count || 0, offset });
      }
      if (action === 'events') {
        const events = await db().collection('rocketchat_workspace_device_events').find({}, { projection: { _id: 0 } }).sort({ at: -1 }).skip(offset).limit(count).toArray();
        return send(res, 200, { success: true, events });
      }
      const body = await read(req);
      if (!body || Object.keys(body).some(key => !['userId', 'deviceId'].includes(key)) || typeof body.userId !== 'string' || !/^[\w-]{1,200}$/.test(body.userId) || !/^[a-f0-9]{64}$/.test(body.deviceId || '')) throw new HttpError(400, 'Некорректное устройство.');
      const target = await core.Users.findOneById(body.userId);
      const token = validTokens(target, Accounts).find(item => publicSession(item, null, '', null).id === body.deviceId);
      if (!token) throw new HttpError(404, 'Сессия уже завершена или не найдена.');
      if (body.userId === actor.user._id && token.hashedToken === actor.hash) throw new HttpError(409, 'Текущую сессию администратора завершайте обычной кнопкой выхода.');
      const connections = await db().collection('rocketchat_sessions').find({ userId: target._id, loginToken: token.hashedToken, logoutAt: { $exists: false } }, { projection: { sessionId: 1 } }).toArray();
      const removed = await core.Users.unsetOneLoginToken(target._id, token.hashedToken);
      if (removed.modifiedCount !== 1) throw new HttpError(404, 'Сессия уже завершена.');
      for (const session of Meteor.server.sessions.values()) {
        const connection = session.connectionHandle;
        if (session.userId === target._id && Accounts._getLoginToken(connection.id) === token.hashedToken) connection.close();
      }
      for (const id of new Set(connections.map(item => item.sessionId).filter(id => typeof id === 'string' && id))) {
        await coreServices.api.broadcast('user.forceLogout', target._id, id);
      }
      await db().collection('rocketchat_sessions').updateMany({ userId: target._id, loginToken: token.hashedToken }, { $set: { logoutAt: new Date(), logoutBy: actor.user._id } });
      await db().collection('rocketchat_workspace_device_events').insertOne({ at: new Date(), action: 'revoke', actor: actor.user.username, actorId: actor.user._id, user: target.username, userId: target._id, deviceId: body.deviceId, ip: normalizeIP(req.socket.remoteAddress) });
      send(res, 200, { success: true });
    })().catch(error => {
      if (!res.headersSent) send(res, error.status || 503, { error: error.status ? error.message : 'Панель временно недоступна.' });
      if (!error.status) console.error('[workspace-devices]', error.message);
    });
  };
  WebApp.rawConnectHandlers.use(middleware);
  const stack = WebApp.rawConnectHandlers.router.stack; const index = stack.findIndex(layer => layer.handle === middleware);
  const [layer] = stack.splice(index, 1); const devices = stack.findIndex(item => item.handle.isAccountDevices);
  stack.splice(devices >= 0 ? devices + 1 : 0, 0, layer);
  Meteor.startup(async () => { await db().collection('rocketchat_workspace_device_events').createIndex({ at: -1 }); console.log('[workspace-devices] Admin device management ready'); });
};
