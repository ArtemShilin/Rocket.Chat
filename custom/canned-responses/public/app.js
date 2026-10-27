(() => {
  if (window.__localCannedApp) return;
  window.__localCannedApp = true;
  const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
  const button = (label, handler) => { const el = node('button', label); el.type = 'button'; el.addEventListener('click', handler); return el; };
  const identity = () => JSON.stringify([localStorage.getItem('Meteor.userId'), localStorage.getItem('Meteor.loginToken')]);
  let account = identity(); let generation = 0; let editor = null; let editorPath = ''; let draft = null; let offset = 0; let nextOffset = null; let busy = false;
  const standalone = document.getElementById('local-canned-page');
  const panel = node(standalone ? 'section' : 'dialog'); panel.className = 'local-canned';
  const title = node('h2', 'Шаблоны ответов');
  const message = node('p'); message.setAttribute('role', 'status');
  const search = node('input'); search.type = 'search'; search.placeholder = 'Поиск шаблонов'; search.setAttribute('aria-label', 'Поиск шаблонов'); search.maxLength = 100;
  const searchForm = node('form'); const find = node('button', 'Найти'); find.type = 'submit'; searchForm.append(search, find);
  const list = node('div'); list.className = 'local-canned-list';
  const form = node('form');
  const shortcut = node('input'); shortcut.required = true; shortcut.maxLength = 48;
  const text = node('textarea'); text.required = true; text.maxLength = 10000; text.rows = 5;
  const scope = node('select');
  for (const [value, label] of [['personal', 'Личный'], ['shared', 'Общий']]) { const option = node('option', label); option.value = value; scope.append(option); }
  for (const [label, input] of [['Название', shortcut], ['Текст ответа', text], ['Доступ', scope]]) { const field = node('label', label); field.append(input); form.append(field); }
  const save = node('button', 'Сохранить'); save.type = 'submit';
  function reset() { draft = null; form.reset(); scope.disabled = false; }
  form.append(save, button('Новый шаблон', reset));
  const previous = button('Назад', () => { offset = Math.max(0, offset - 50); load(); });
  const next = button('Далее', () => { offset = nextOffset; load(); });
  panel.append(title, button('Закрыть', () => { if (!standalone) panel.close(); }), message, searchForm, list, previous, next, form);
  (standalone || document.body).append(panel);
  function clear() { generation++; account = identity(); list.replaceChildren(); reset(); editor = null; message.textContent = 'Учётная запись изменилась. Откройте шаблоны заново.'; if (!standalone) panel.close(); }
  async function api(action, body) {
    const before = identity(); const [uid, token] = JSON.parse(before);
    if (before !== account) { clear(); throw new Error('Учётная запись изменилась.'); }
    if (!uid || !token) throw new Error('Сначала войдите в Rocket.Chat.');
    const response = await fetch('/api/v1/local-canned-responses/' + action, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: { 'X-User-Id': uid, 'X-Auth-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (before !== identity()) { clear(); throw new Error('Учётная запись изменилась.'); }
    const data = await response.json();
    if (before !== identity()) { clear(); throw new Error('Учётная запись изменилась.'); }
    if (!response.ok) { if (response.status === 401) { list.replaceChildren(); reset(); if (!standalone) panel.close(); } throw new Error(data.error); }
    return data;
  }
  function insert(value) {
    if (account !== identity()) { clear(); return; }
    if (!editor?.isConnected || editor.disabled || editor.readOnly || location.pathname !== editorPath) { message.textContent = 'Редактор недоступен. Откройте шаблоны в нужном чате.'; return; }
    const start = editor.selectionStart; const end = editor.selectionEnd;
    const updated = editor.value.slice(0, start) + value + editor.value.slice(end);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, updated);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    panel.close(); editor.focus(); editor.setSelectionRange(start + value.length, start + value.length);
  }
  async function load() {
    const seq = ++generation;
    list.replaceChildren(); message.textContent = 'Загрузка…';
    try {
      const result = await api('list?offset=' + offset + '&q=' + encodeURIComponent(search.value));
      if (seq !== generation) return;
      scope.querySelector('[value="shared"]').disabled = !result.admin;
      nextOffset = result.nextOffset; previous.disabled = offset === 0; next.disabled = nextOffset === null;
      for (const item of result.items) {
        const card = node('article'); card.append(node('strong', item.shortcut + (item.scope === 'shared' ? ' · Общий' : ' · Личный')), node('pre', item.text));
        if (!standalone) card.append(button('Вставить', () => insert(item.text)));
        if (item.editable) {
          card.append(button('Изменить', () => { draft = item; shortcut.value = item.shortcut; text.value = item.text; scope.value = item.scope; scope.disabled = true; shortcut.focus(); }));
          card.append(button('Удалить', async () => {
            if (busy || !confirm('Удалить шаблон «' + item.shortcut + '»?')) return;
            busy = true;
            try { await api('remove', { id: item._id, revision: item.revision }); reset(); await load(); } catch (error) { message.textContent = error.message; } finally { busy = false; }
          }));
        }
        list.append(card);
      }
      message.textContent = result.items.length ? 'Выберите шаблон или создайте новый.' : 'Шаблоны не найдены.';
    } catch (error) { if (seq === generation) message.textContent = error.message; }
  }
  searchForm.addEventListener('submit', event => { event.preventDefault(); offset = 0; load(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; busy = true; save.disabled = true;
    try { await api('save', { ...(draft ? { id: draft._id, revision: draft.revision } : {}), shortcut: shortcut.value, text: text.value, scope: scope.value }); reset(); offset = 0; await load(); }
    catch (error) { message.textContent = error.message; } finally { busy = false; save.disabled = false; }
  });
  addEventListener('storage', event => { if (['Meteor.userId', 'Meteor.loginToken'].includes(event.key)) clear(); });
  setInterval(() => { if (account !== identity()) clear(); }, 1000);
  if (standalone) { load(); return; }
  // Plain-text composer only: rich-text editor needs its own supported insertion API.
  const enhance = () => {
    document.querySelectorAll('textarea.js-input-message').forEach(input => {
      if (input.parentElement.querySelector('[data-local-canned-button]')) return;
      const open = button('Шаблоны', () => {
        if (account !== identity()) clear();
        editor = input; editorPath = location.pathname; offset = 0; reset(); panel.showModal(); load();
      });
      open.dataset.localCannedButton = 'true'; open.className = 'local-canned-launch';
      input.parentElement.append(open);
    });
  };
  let scheduled = false;
  new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; enhance(); }); } }).observe(document.body, { subtree: true, childList: true });
  enhance();
})();
