(() => {
  const el = id => document.getElementById(id);
  let busy = false; let ready = false; let currentJob = null; let nextOffset = null; let generation = 0;
  const savedKey = () => "local-ai-job:" + localStorage.getItem("Meteor.userId");
  const handoff = new URLSearchParams(location.hash.slice(1)).get("q");
  if (handoff) { el("query").value = handoff; history.replaceState(null, "", location.pathname); }
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
  function sources(items, meta, append = false) {
    const cards = items.map((source, index) => {
      const card = node('article', null, 'source');
      const head = node('div', null, 'source-head');
      const link = node('a', `${source.roomName} ↗`);
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      head.append(link, node('span', source.date ? new Date(source.date).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : ''));
      card.append(head, node('p', source.text, 'source-text'), node('div', source.author, 'source-meta'));
      return card;
    });
    if (append) el('sources').append(...cards); else el('sources').replaceChildren(...cards);
    el('coverage').textContent = meta ? `Проверено ${meta.scanned} сообщений · ${meta.rooms || 1} каналов · найдено ${meta.total ?? items.length}` : `${items.length} сообщений`;
    el('sources-section').hidden = !el('sources').childElementCount;
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
  async function loadResult(append = false) {
    const id = currentJob;
    const result = await api('jobs/' + id + '/result?offset=' + (append ? nextOffset : 0));
    if (id !== currentJob) return;
    sources(result.sources, result.meta, append);
    if (result.answer && !append) answer(result.answer, result.answerSources, result.meta?.summary);
    nextOffset = result.nextOffset; el('more').hidden = nextOffset == null;
  }
  async function monitor(id) {
    const epoch = ++generation; busy = true; currentJob = id; controls(); el('cancel').hidden = false;
    try {
      while (epoch === generation) {
        const { job } = await api('jobs/' + id);
        if (epoch !== generation) return;
        if (job.status === 'done') { await loadResult(); sessionStorage.removeItem(savedKey()); status('Готово. Все найденные сообщения доступны на следующих страницах.'); return; }
        if (['cancelled', 'failed'].includes(job.status)) throw new Error(job.error || 'Задача отменена.');
        const p = job.progress;
        const phase = { index: 'Поиск по всей истории', summary: 'Сводка всей истории', answer: 'Формирование ответа', verify: 'Проверка источников', question: 'Обработка вопроса' }[p.phase] || 'Подготовка';
        status(job.status === 'queued' ? 'В очереди: ' + job.position : `${phase} · сообщений: ${p.scanned || 0} · каналов: ${p.roomsDone || 0}/${p.rooms || 1} · обращений к модели: ${p.modelCalls || 0}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (epoch === generation) { status(error.message, true); sessionStorage.removeItem(savedKey()); }
    } finally { if (epoch === generation) { busy = false; controls(); el('cancel').hidden = true; } }
  }
  async function run(summary = false) {
    if (busy) return;
    busy = true; controls(); el('answer-section').hidden = true; el('sources-section').hidden = true; el('more').hidden = true;
    try {
      const roomId = el('room').value;
      const body = summary ? { operation: 'summary', roomId } : { operation: 'search', query: el('query').value.trim(), ...(roomId ? { roomId } : {}), generate: el('generate').checked };
      const { job } = await api('jobs', body);
      sessionStorage.setItem(savedKey(), job.id);
      await monitor(job.id);
    } catch (error) { status(error.message, true); busy = false; controls(); }
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
    const saved = sessionStorage.getItem(savedKey());
    if (ready && saved) monitor(saved);
  }
  el('more').addEventListener('click', async () => { el('more').disabled = true; try { await loadResult(true); } catch (error) { status(error.message, true); } finally { el('more').disabled = false; } });
  el('cancel').addEventListener('click', async () => { try { await api('jobs/' + currentJob + '/cancel', {}); } catch (error) { status(error.message, true); } });
  el('form').addEventListener('submit', event => { event.preventDefault(); run(); });
  el('summary').addEventListener('click', () => run(true));
  el('room').addEventListener('change', controls);
  window.addEventListener('storage', event => {
    if (['Meteor.loginToken', 'Meteor.userId'].includes(event.key)) {
      generation++; currentJob = null; busy = false; el('cancel').hidden = true; el('more').hidden = true;
      ready = false; el('sources-section').hidden = true; el('answer-section').hidden = true; initialize();
    }
  });
  initialize();
})();
