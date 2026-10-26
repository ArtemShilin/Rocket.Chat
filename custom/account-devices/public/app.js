(() => {
  const el = id => document.getElementById(id);
  const pageSize = 25;
  let offset = 0;
  let busy = false;
  let total = 0;
  const date = value => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Нет данных';
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text != null) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function render(session) {
    const row = node('tr');
    row.dataset.current = String(session.current);
    const device = session.device || {};
    const type = device.type || 'unknown';
    const names = { desktop: 'Компьютер', mobile: 'Смартфон', tablet: 'Планшет', browser: 'Браузер' };
    const cell = node('td');
    const group = node('div', null, 'device');
    const icon = node('span', ['mobile', 'tablet'].includes(type) ? '▯' : '▣', 'icon');
    icon.setAttribute('aria-hidden', 'true');
    group.append(icon);
    const info = node('div');
    info.append(node('div', device.model || names[type] || 'Неизвестное устройство', 'name'));
    info.append(node('div', [device.name, device.version].filter(Boolean).join(' ') || 'Нет данных о браузере', 'detail'));
    if (device.os?.name) info.append(node('div', [device.os.name, device.os.version].filter(Boolean).join(' '), 'detail'));
    if (session.current) info.append(node('span', 'Это устройство', 'current'));
    group.append(info); cell.append(group); row.append(cell);
    row.append(node('td', session.ip || 'Нет данных', 'ip'));
    const location = session.location;
    const city = location.kind === 'local' ? 'Локальная сеть' : location.city || 'Не определён';
    const cityCell = node('td');
    cityCell.append(node('div', city));
    if (location.country) cityCell.append(node('div', location.country, 'detail'));
    row.append(cityCell, node('td', date(session.loginAt), 'date'), node('td', date(session.lastActivityAt), 'date'));
    ['Устройство', 'IP-адрес', 'Город', 'Вход выполнен', 'Активность'].forEach((label, index) => {
      row.children[index].dataset.label = label;
    });
    return row;
  }
  async function load() {
    if (busy) return;
    busy = true; el('refresh').disabled = true;
    el('status').className = '';
    el('status').textContent = 'Обновляем список устройств…';
    try {
      const uid = localStorage.getItem('Meteor.userId');
      const token = localStorage.getItem('Meteor.loginToken');
      if (!uid || !token) throw new Error('Сначала войдите в Rocket.Chat на этом устройстве и откройте эту страницу снова.');
      const response = await fetch(`/api/v1/account.devices?offset=${offset}&count=${pageSize}`, {
        cache: 'no-store', headers: { 'X-User-Id': uid, 'X-Auth-Token': token },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? 'Вход завершён. Вернитесь в Rocket.Chat и авторизуйтесь снова.' : data.error);
      total = data.total;
      if (offset >= total && offset > 0) { offset = 0; busy = false; return load(); }
      el('account').textContent = '@' + data.username;
      el('devices').replaceChildren(...data.sessions.map(render));
      el('results').hidden = false;
      el('total').textContent = total ? `${offset + 1}–${offset + data.count} из ${total}` : 'Сохранённых входов нет';
      el('previous').disabled = offset === 0;
      el('next').disabled = offset + data.count >= total;
      el('status').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      el('results').hidden = true;
      el('status').textContent = error.message || 'Не удалось загрузить устройства. Повторите попытку.';
      el('status').className = 'error';
    } finally {
      busy = false; el('refresh').disabled = false;
    }
  }
  el('refresh').addEventListener('click', load);
  el('previous').addEventListener('click', () => { offset = Math.max(0, offset - pageSize); load(); });
  el('next').addEventListener('click', () => { offset += pageSize; load(); });
  window.addEventListener('storage', event => { if (['Meteor.loginToken', 'Meteor.userId'].includes(event.key)) load(); });
  load();
})();
