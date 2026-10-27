(() => {
  if (window.__localMessageViews) return;
  window.__localMessageViews = true;
  const identity = () => JSON.stringify([localStorage.getItem('Meteor.userId'), localStorage.getItem('Meteor.loginToken')]);
  let account = identity(); let generation = 0; let dialog;
  const node = (tag, text) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
  const button = (label, handler) => { const item = node('button', label); item.type = 'button'; item.addEventListener('click', handler); return item; };
  function clear() { generation++; account = identity(); dialog?.close(); dialog?.remove(); dialog = null; }
  async function api(action, body) {
    const before = identity();
    if (account !== before) { clear(); throw new Error('Учётная запись изменилась. Откройте сообщение заново.'); }
    const [uid, token] = JSON.parse(before);
    if (!uid || !token) throw new Error('Войдите в Rocket.Chat.');
    const response = await fetch('/api/v1/message-views/' + action, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': uid, 'X-Auth-Token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (before !== identity()) { clear(); throw new Error('Учётная запись изменилась.'); }
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  async function open(messageId, offset = 0) {
    if (account !== identity()) clear();
    const sequence = ++generation;
    dialog?.close(); dialog?.remove();
    const current = node('dialog'); current.className = 'local-message-views';
    current.append(node('h2', 'Подтверждения просмотра'), button('Закрыть', () => { generation++; current.close(); current.remove(); if (dialog === current) dialog = null; }));
    const status = node('p', 'Загрузка…'); status.setAttribute('role', 'status'); current.append(status);
    dialog = current; document.body.append(current); current.showModal();
    try {
      const result = await api('inspect?messageId=' + encodeURIComponent(messageId) + '&offset=' + offset);
      if (sequence !== generation || !current.open) return;
      const text = node('pre', result.text); current.append(text);
      status.textContent = 'Учитываются только явные подтверждения текущей версии сообщения. Записи хранятся 90 дней.';
      if (result.author) {
        const list = node('ul'); list.className = 'local-message-view-readers';
        for (const reader of result.readers) list.append(node('li', `${reader.name}${reader.username ? ' (@' + reader.username + ')' : ''} — ${new Date(reader.at).toLocaleString('ru-RU')}`));
        if (!result.readers.length) current.append(node('p', 'Подтверждений пока нет.'));
        current.append(list);
        if (offset) current.append(button('Назад', () => open(messageId, Math.max(0, offset - 50))));
        if (result.nextOffset !== null) current.append(button('Далее', () => open(messageId, result.nextOffset)));
        current.append(button('Обновить', () => open(messageId, offset)));
      } else if (result.confirmedAt) {
        current.append(node('p', 'Вы подтвердили просмотр: ' + new Date(result.confirmedAt).toLocaleString('ru-RU')));
      } else {
        const confirm = button('Подтверждаю просмотр', async () => {
          confirm.disabled = true;
          try {
            const response = await api('acknowledge', { messageId, version: result.version });
            if (sequence !== generation || !current.open) return;
            status.textContent = 'Просмотр подтверждён: ' + new Date(response.confirmedAt).toLocaleString('ru-RU');
            confirm.remove();
          } catch (error) { status.textContent = error.message; confirm.disabled = false; }
        });
        current.append(confirm);
      }
    } catch (error) { if (sequence === generation && current.open) status.textContent = error.message; }
  }
  const enhance = () => {
    if (!localStorage.getItem('Meteor.userId')) return;
    document.querySelectorAll('[data-mid][data-own]').forEach(message => {
      if (message.querySelector('[data-local-message-view]')) return;
      const action = button(message.dataset.own === 'true' ? 'Кто подтвердил просмотр' : 'Подтвердить просмотр', () => open(message.dataset.mid));
      action.dataset.localMessageView = 'true'; action.className = 'local-message-view-action';
      (message.querySelector('.rcx-message-container') || message).append(action);
    });
  };
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhance(); });
  }).observe(document.body, { childList: true, subtree: true });
  addEventListener('storage', event => { if (['Meteor.userId', 'Meteor.loginToken'].includes(event.key)) clear(); });
  setInterval(() => { if (account !== identity()) clear(); }, 1000);
  enhance();
})();
