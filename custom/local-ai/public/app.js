(() => {
  const el = id => document.getElementById(id);
  let busy = false; let ready = false;
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function controls() { el('search').disabled = busy || !ready; el('summary').disabled = busy || !ready || !el('room').value; }
  function status(text, error = false) { el('status').textContent = text; el('status').className = error ? 'error' : ''; }
  async function api(action, body) {
    const user = localStorage.getItem('Meteor.userId'); const token = localStorage.getItem('Meteor.loginToken');
    if (!user || !token) throw new Error('Сначала войдите в Rocket.Chat и откройте эту страницу снова.');
    const response = await fetch('/api/v1/local-ai/' + action, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { 'X-User-Id': user, 'X-Auth-Token': token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (user !== localStorage.getItem('Meteor.userId') || token !== localStorage.getItem('Meteor.loginToken')) {
      throw new Error('Учётная запись изменилась. Повторите запрос.');
    }
    if (!response.ok) throw new Error(response.status === 401 ? 'Вход завершён. Вернитесь в Rocket.Chat и авторизуйтесь снова.' : result.error);
    return result;
  }
  function sources(items, meta) {
    el('sources').replaceChildren(...items.map((source, index) => {
      const card = node('article', null, 'source');
      const head = node('div', null, 'source-head');
      const link = node('a', `[${index + 1}] ${source.roomName} ↗`);
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      head.append(link, node('span', source.date ? new Date(source.date).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : ''));
      card.append(head, node('p', source.text, 'source-text'), node('div', source.author, 'source-meta'));
      return card;
    }));
    el('coverage').textContent = meta ? `Проверено ${meta.scanned} сообщений · ${meta.rooms} каналов${meta.limited ? ' · достигнут лимит, уточните канал' : ''}` : `${items.length} сообщений`;
    el('sources-section').hidden = !items.length;
  }
  function answer(text, items, summary = false) {
    el('answer-title').textContent = summary ? 'Краткая сводка канала' : 'Ответ по переписке';
    const parts = text.split(/(\[\d+\])/g).map(part => {
      const match = part.match(/^\[(\d+)\]$/); const source = match && items[Number(match[1]) - 1];
      if (!source) return document.createTextNode(part);
      const link = node('a', part); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
    });
    el('answer').replaceChildren(...parts); el('answer-section').hidden = false;
  }
  async function run(summary = false) {
    if (busy) return;
    busy = true; controls(); el('answer-section').hidden = true; el('sources-section').hidden = true;
    status(summary ? 'Читаем доступные сообщения и готовим сводку…' : 'Ищем подходящие сообщения по смыслу… Первый поиск может занять больше времени.');
    try {
      if (summary) {
        const result = await api('summary', { roomId: el('room').value });
        sources(result.sources); answer(result.answer, result.sources, true);
      } else {
        const query = el('query').value.trim();
        const roomId = el('room').value;
        const result = await api('search', { query, ...(roomId ? { roomId } : {}) });
        sources(result.sources, result.meta);
        if (!result.sources.length) { status('Подходящих сообщений не найдено. Уточните вопрос или выберите другой канал.'); return; }
        if (el('generate').checked) {
          status('Сообщения найдены. Формируем ответ по источникам… На этом компьютере это может занять несколько минут.');
          const generated = await api('answer', { query, messageIds: result.sources.map(item => item.id) });
          sources(generated.sources, result.meta); answer(generated.answer, generated.sources);
        }
      }
      status('Готово. Откройте источники, чтобы проверить детали.');
    } catch (error) { status(error.message || 'Не удалось обработать запрос. Повторите попытку.', true); }
    finally { busy = false; controls(); }
  }
  async function initialize() {
    controls();
    try {
      const [info, result] = await Promise.all([api('status'), api('rooms')]);
      el('account').textContent = '@' + info.username; ready = info.ready;
      el('room').replaceChildren(node('option', 'Во всех моих каналах и чатах'), ...result.rooms.map(room => {
        const option = node('option', (room.type === 'd' ? '@' : '#') + room.name); option.value = room.id; return option;
      }));
      el('room').options[0].value = '';
      status(ready ? 'Локальный ИИ готов. Выберите канал или задайте вопрос по всей доступной переписке.' : 'Модели ещё загружаются или сервис недоступен. Обновите страницу позже.', !ready);
    } catch (error) { status(error.message, true); }
    controls();
  }
  el('form').addEventListener('submit', event => { event.preventDefault(); run(); });
  el('summary').addEventListener('click', () => run(true));
  el('room').addEventListener('change', controls);
  window.addEventListener('storage', event => {
    if (['Meteor.loginToken', 'Meteor.userId'].includes(event.key)) {
      ready = false; el('sources-section').hidden = true; el('answer-section').hidden = true; initialize();
    }
  });
  initialize();
})();
