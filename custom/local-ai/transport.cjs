const { setTimeout: wait } = require('node:timers/promises');
const { HttpError } = require('./domain.cjs');

async function requestChat(endpoint, body, headers, signal, { fetchImpl = fetch, waitImpl = wait } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchImpl('http://127.0.0.1:3000/api/v1/' + endpoint, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
    if (response.status === 429) {
      await response.text();
      if (attempt < 2) {
        const reset = Number(response.headers.get('X-RateLimit-Reset'));
        const remaining = Number.isFinite(reset) && reset > Date.now() ? reset - Date.now() : 60000;
        const delay = Math.min(61000, Math.max(1000, remaining + 1000));
        await waitImpl(delay, undefined, { signal });
        continue;
      }
      throw new HttpError(429, 'Слишком частые запросы. Повторите через минуту.');
    }
    if (!response.ok) throw new HttpError([401, 403].includes(response.status) ? response.status : 409, 'Источник недоступен или вход завершён. Повторите поиск.');
    const result = await response.json();
    if (result.success === false) throw new HttpError(403, 'Источник недоступен.');
    return result;
  }
}

module.exports = { requestChat };
