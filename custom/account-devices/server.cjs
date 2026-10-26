const fs = require('node:fs');
const path = require('node:path');
const maxmind = require('maxmind');
const UAParser = require('ua-parser-js');
const { normalizeIP, publicSession } = require('./domain.cjs');

module.exports = function registerAccountDevices({ Meteor, Accounts, WebApp, MongoInternals }) {
  const reader = new maxmind.Reader(fs.readFileSync(path.join(__dirname, 'data/city.mmdb')));
  const assets = new Map([
    ['/my-devices', ['index.html', 'text/html; charset=utf-8']],
    ['/my-devices/', ['index.html', 'text/html; charset=utf-8']],
    ['/my-devices/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/my-devices/style.css', ['style.css', 'text/css; charset=utf-8']],
  ].map(([url, [name, type]]) => [url, { body: fs.readFileSync(path.join(__dirname, 'public', name)), type }]));

  const respond = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const database = () => MongoInternals.defaultRemoteCollectionDriver().mongo.db;

  async function observe(req, userId, tokenHash, token) {
    const agent = new UAParser(req.headers['user-agent'] || '').getResult();
    await database().collection('rocketchat_account_device_observations').updateOne({ userId, tokenHash }, {
      $set: {
        // No reverse proxy is configured; forwarded client addresses are not trusted.
        ip: normalizeIP(req.socket.remoteAddress), lastActivityAt: new Date(),
        expiresAt: Accounts._tokenExpiration(token.when),
        device: {
          name: agent.browser.name || 'Неизвестный клиент', version: agent.browser.version || '',
          type: agent.device.type || (agent.browser.name ? 'desktop' : 'unknown'),
          model: [agent.device.vendor, agent.device.model].filter(Boolean).join(' '),
          os: { name: agent.os.name || '', version: agent.os.version || '' },
        },
      },
    }, { upsert: true });
  }

  const recentlyObserved = new Map();
  async function observeAuthenticatedRequest(req) {
    const uid = req.headers['x-user-id'];
    const raw = req.headers['x-auth-token'];
    if (typeof uid !== 'string' || typeof raw !== 'string' || uid.length > 200 || raw.length > 512) return;
    const hash = Accounts._hashLoginToken(raw);
    const key = uid + ':' + hash;
    if (Date.now() - (recentlyObserved.get(key) || 0) < 60000) return;
    if (recentlyObserved.size >= 5000) recentlyObserved.clear();
    recentlyObserved.set(key, Date.now());
    const user = await database().collection('users').findOne({
      _id: uid, active: { $ne: false }, 'services.resume.loginTokens.hashedToken': hash,
    }, { projection: { 'services.resume.loginTokens': 1 } });
    const token = user?.services?.resume?.loginTokens?.find(item =>
      item.hashedToken === hash && item.when && !item.name && Accounts._tokenExpiration(item.when) > new Date());
    if (token) await observe(req, uid, hash, token);
  }

  Meteor.startup(async () => {
    const observations = database().collection('rocketchat_account_device_observations');
    await observations.createIndex({ userId: 1, tokenHash: 1 }, { unique: true });
    await observations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    console.log('[account-devices] Personal device list and offline city lookup ready');
  });

  const middleware = (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    const asset = assets.get(url.pathname);
    if (asset) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, { error: 'Method not allowed' });
      res.writeHead(200, {
        'Content-Type': asset.type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : asset.body);
      return;
    }
    if (url.pathname !== '/api/v1/account.devices') {
      if (url.pathname.startsWith('/api/')) {
        observeAuthenticatedRequest(req).catch(error => console.error('[account-devices] Device capture failed:', error.message));
      }
      return next();
    }
    if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
    if ([...url.searchParams.keys()].some(key => !['offset', 'count'].includes(key))) {
      return respond(res, 400, { error: 'Only offset and count are accepted' });
    }
    const offset = Number(url.searchParams.get('offset') || 0);
    const count = Number(url.searchParams.get('count') || 25);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) || count < 1 || count > 100) {
      return respond(res, 400, { error: 'Invalid pagination' });
    }
    const userId = req.headers['x-user-id'];
    const rawToken = req.headers['x-auth-token'];
    if (typeof userId !== 'string' || typeof rawToken !== 'string' || userId.length > 200 || rawToken.length > 512) {
      return respond(res, 401, { error: 'Please sign in to Rocket.Chat' });
    }
    (async () => {
      const db = database();
      const tokenHash = Accounts._hashLoginToken(rawToken);
      const user = await db.collection('users').findOne({
        _id: userId, active: { $ne: false },
        'services.resume.loginTokens.hashedToken': tokenHash,
      }, { projection: { username: 1, 'services.resume.loginTokens': 1 } });
      const now = new Date();
      const tokens = (user?.services?.resume?.loginTokens || []).filter(token =>
        token.hashedToken && token.when && !token.name && Accounts._tokenExpiration(token.when) > now);
      const current = tokens.find(token => token.hashedToken === tokenHash);
      if (!current) return respond(res, 401, { error: 'Session expired. Please sign in again' });

      const observations = db.collection('rocketchat_account_device_observations');
      await observe(req, userId, tokenHash, current);

      const validHashes = tokens.map(token => token.hashedToken);
      const recorded = await db.collection('rocketchat_sessions').find({
        userId, type: 'session', loginToken: { $in: validHashes }, logoutAt: { $exists: false },
      }, { projection: { loginToken: 1, device: 1, ip: 1, loginAt: 1, lastActivityAt: 1, closedAt: 1 } })
        .sort({ loginAt: -1 }).limit(5000).toArray();
      const metadata = new Map();
      for (const record of recorded) {
        if (!metadata.has(record.loginToken)) metadata.set(record.loginToken, record);
      }
      const observed = await observations.find({ userId, tokenHash: { $in: validHashes } }, {
        projection: { tokenHash: 1, device: 1, ip: 1, lastActivityAt: 1 },
      }).toArray();
      for (const record of observed) metadata.set(record.tokenHash, record);

      tokens.sort((a, b) => Number(b.hashedToken === tokenHash) - Number(a.hashedToken === tokenHash) ||
        new Date(b.when) - new Date(a.when));
      const sessions = tokens.slice(offset, offset + count).map(token =>
        publicSession(token, metadata.get(token.hashedToken), tokenHash, reader));
      respond(res, 200, { success: true, username: user.username, sessions, total: tokens.length, offset, count: sessions.length });
    })().catch(error => {
      console.error('[account-devices] Failed to list devices:', error.message);
      if (!res.headersSent) respond(res, 503, { error: 'Список устройств временно недоступен. Повторите попытку.' });
      else res.end();
    });
  };
  // Rocket.Chat installs an /api catch-all before application startup. Our narrowly
  // scoped handler must run ahead of it; all unrelated requests continue unchanged.
  WebApp.rawConnectHandlers.use(middleware);
  const stack = WebApp.rawConnectHandlers.router.stack;
  const index = stack.findIndex(layer => layer.handle === middleware);
  if (index < 0) throw new Error('Unsupported WebApp middleware stack');
  stack.unshift(...stack.splice(index, 1));
};
