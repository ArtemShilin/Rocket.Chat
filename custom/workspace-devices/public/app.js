(() => {
  const el = id => document.getElementById(id); let offset = 0; let total = 0; let until = 0; let digest = ''; let busy = false;
  const node = (tag, text, css) => { const item = document.createElement(tag); if (text != null) item.textContent = text; if (css) item.className = css; return item; };
  const date = value => value ? new Date(value).toLocaleString('ru-RU') : 'Нет данных';
  const status = (text, error = false) => { el('status').textContent = text; el('status').className = error ? 'error' : ''; };
  function lock() { until = 0; digest = ''; el('password').value = ''; el('password').required = true; el('code').value = ''; el('factor').hidden = true; el('sessions').replaceChildren(); el('events').replaceChildren(); el('panel').hidden = true; el('unlock').hidden = false; }
  async function api(action, body) {
    const uid = localStorage.getItem('Meteor.userId'); const token = localStorage.getItem('Meteor.loginToken');
    if (!uid || !token) throw new Error('Сначала войдите в Rocket.Chat.');
    const response = await fetch('/api/v1/workspace-devices/' + action, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: { 'X-User-Id': uid, 'X-Auth-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (uid !== localStorage.getItem('Meteor.userId') || token !== localStorage.getItem('Meteor.loginToken')) { lock(); throw new Error('Учётная запись изменилась.'); }
    if (!response.ok) { if ([401, 403].includes(response.status) || response.status === 428 && action !== 'reauth') lock(); const error = new Error(result.error); error.method = result.method; throw error; }
    return result;
  }
  async function load() {
    if (busy) return; busy = true; el('refresh').disabled = true;
    try {
      const result = await api('list?offset=' + offset + '&user=' + encodeURIComponent(el('user').value.trim())); total = result.total;
      el('sessions').replaceChildren(...result.sessions.map(item => {
        const card = node('article', null, 'session'); card.dataset.id = item.id;
        const user = node('div'); user.append(node('strong', '@' + item.username), node('div', item.name, 'meta'));
        const device = node('div'); device.append(node('strong', item.device?.model || item.device?.name || 'Неизвестный клиент'), node('div', [item.device?.name, item.device?.version, item.device?.os?.name, item.device?.os?.version].filter(Boolean).join(' · '), 'meta'));
        if (item.current) device.append(node('div', 'Текущая сессия администратора', 'meta'));
        const place = node('div'); place.append(node('strong', item.ip || 'IP не записан'), node('div', item.location.kind === 'local' ? 'Локальная сеть' : [item.location.city, item.location.country].filter(Boolean).join(', ') || 'Город не определён', 'meta'), node('div', 'Вход: ' + date(item.loginAt), 'meta'), node('div', 'Активность: ' + date(item.lastActivityAt), 'meta'));
        const revoke = node('button', item.current ? 'Текущая' : 'Завершить', 'danger'); revoke.type = 'button'; revoke.disabled = item.current;
        revoke.addEventListener('click', async () => {
          if (!confirm(`Завершить вход @${item.username} на ${item.device?.name || 'устройстве'} (${item.ip || 'IP неизвестен'})?`)) return;
          revoke.disabled = true;
          try { await api('revoke', { userId: item.userId, deviceId: item.id }); await load(); status('Выбранная сессия завершена.'); } catch (error) { status(error.message, true); revoke.disabled = false; }
        });
        card.append(user, device, place, revoke); return card;
      }));
      el('total').textContent = 'Активных сессий: ' + total; el('page').textContent = total ? `${offset + 1}–${Math.min(offset + 25, total)} из ${total}` : 'Нет сессий';
      el('prev').disabled = offset === 0; el('next').disabled = offset + 25 >= total;
      el('panel').hidden = false; el('unlock').hidden = true;
      const history = await api('events');
      el('events').replaceChildren(...history.events.map(item => node('div', `${date(item.at)} · @${item.actor} завершил сессию @${item.user}`, 'event')));
      if (!history.events.length) el('events').append(node('p', 'Действий пока нет.', 'hint'));
      status('Доступ подтверждён до ' + new Date(until).toLocaleTimeString('ru-RU'));
    } catch (error) { status(error.message, true); }
    finally { busy = false; el('refresh').disabled = false; }
  }
  el('unlock').addEventListener('submit', async event => {
    event.preventDefault(); const button = el('unlock').querySelector('button'); button.disabled = true;
    try {
      if (el('password').value) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(el('password').value)); digest = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''); el('password').value = ''; el('password').required = false; }
      const result = await api('reauth', { passwordDigest: digest, ...(el('code').value ? { code: el('code').value } : {}) });
      until = result.expiresAt; digest = ''; el('code').value = ''; el('factor').hidden = true; await load();
    } catch (error) { if (error.method && error.method !== 'password') { el('factor').hidden = false; el('code').focus(); } else { digest = ''; el('password').required = true; el('password').focus(); } status(error.message, true); }
    finally { button.disabled = false; }
  });
  el('filter').addEventListener('submit', event => { event.preventDefault(); offset = 0; load(); });
  el('refresh').addEventListener('click', load); el('prev').addEventListener('click', () => { offset = Math.max(0, offset - 25); load(); }); el('next').addEventListener('click', () => { offset += 25; load(); });
  addEventListener('storage', event => { if (['Meteor.userId', 'Meteor.loginToken'].includes(event.key)) { lock(); status('Учётная запись изменилась. Обновите страницу.', true); } });
  setInterval(() => { if (until && Date.now() >= until) { lock(); status('Подтвердите доступ снова.'); } }, 10000);
  api('status').then(info => { if (info.authorized) { until = info.expiresAt; load(); } else { lock(); status('Подтвердите доступ паролем администратора.'); } }).catch(error => { el('unlock').hidden = true; status(error.message, true); });
})();
