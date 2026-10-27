(() => {
  if (window.__nativePolls) return;
  window.__nativePolls = true;
  const node = (tag, text, css) => { const el = document.createElement(tag); if (text !== undefined && text !== null) el.textContent = text; if (css) el.className = css; return el; };
  const button = (text, action, css = 'np-button') => { const el = node('button', text, css); el.type = 'button'; el.addEventListener('click', action); return el; };
  const identity = () => JSON.stringify([localStorage.getItem('Meteor.userId'), localStorage.getItem('Meteor.loginToken')]);
  const entries = new Set(); let account = identity(); let epoch = 0; let createDialog;
  const standalone = document.getElementById('poll-page');
  const date = value => new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function clear() {
    epoch++; account = identity();
    createDialog?.close(); createDialog?.remove(); createDialog = null;
    for (const entry of entries) { entry.root.replaceChildren(node('p', 'Войдите, чтобы увидеть опрос.', 'np-note')); entry.data = null; entry.dirty = false; }
  }
  async function api(action, body) {
    const before = identity();
    if (before !== account) { clear(); throw new Error('Учётная запись изменилась. Повторите действие.'); }
    const [uid, token] = JSON.parse(before);
    if (!uid || !token) throw new Error('Войдите в Rocket.Chat, чтобы открыть опрос.');
    const response = await fetch('/api/v1/native-polls/' + action, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-User-Id': uid, 'X-Auth-Token': token }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (before !== identity()) { clear(); throw new Error('Учётная запись изменилась.'); }
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  }
  async function load(entry, quiet = false) {
    if (entry.busy) return;
    const current = epoch; entry.busy = true;
    try {
      const data = await api('get?pollId=' + encodeURIComponent(entry.id));
      if (current !== epoch || !entry.root.isConnected) return;
      if (entry.messageId && data.messageId !== entry.messageId) { entry.root.closest('[data-mid]').dataset.npMismatch = entry.id; entry.root.remove(); entries.delete(entry); return; }
      entry.data = data; entry.dirty = false; render(entry);
      if (entry.messageId) entry.root.closest('[data-mid]')?.classList.add('np-message');
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) entry.data = null;
      if (current === epoch && (!quiet || !entry.data)) entry.root.replaceChildren(node('p', error.message, 'np-error'), button('Повторить', () => load(entry)));
      if (error.status === 425 && (entry.retries || 0) < 4) { entry.retries = (entry.retries || 0) + 1; setTimeout(() => { if (current === epoch && entry.root.isConnected) load(entry); }, 500 * entry.retries); }
    } finally { entry.busy = false; }
  }
  function render(entry, notice) {
    const data = entry.data; const root = entry.root; root.replaceChildren();
    root.className = 'np-card'; root.dataset.pollId = data.id;
    const heading = node('div', null, 'np-heading');
    heading.append(node('span', 'ОПРОС', 'np-eyebrow'), node('span', data.closed ? 'Завершён' : 'Принимает голоса', data.closed ? 'np-badge' : 'np-badge np-badge-open'));
    root.append(heading, node('h3', data.question, 'np-question'));
    if (data.description) root.append(node('p', data.description, 'np-description'));
    const info = [data.anonymous ? 'Анонимный' : 'Открытое голосование', data.multiple ? 'До ' + data.maxSelections + ' вариантов' : 'Один вариант'];
    root.append(node('p', info.join(' · '), 'np-note'));
    const form = node('form'); form.setAttribute('aria-label', data.question); const choices = new Set(data.own);
    let submitting = false;
    const status = node('p', notice || '', 'np-status'); status.setAttribute('role', 'status');
    for (const option of data.options) {
      const line = node('div', null, 'np-option-wrap');
      const label = node('label', null, 'np-option' + (choices.has(option.id) ? ' np-selected' : ''));
      const input = node('input'); input.type = data.multiple ? 'checkbox' : 'radio'; input.name = 'choice-' + data.id; input.value = option.id; input.checked = choices.has(option.id); input.disabled = data.closed; input.setAttribute('aria-label', option.label);
      const text = node('span', option.label, 'np-option-text'); label.append(input, text);
      if (data.resultsVisible) {
        const percentage = data.total ? Math.round(100 * option.count / data.total) : 0;
        label.append(node('span', percentage + '% · ' + option.count, 'np-count'));
        const bar = node('progress'); bar.max = 100; bar.value = percentage; bar.setAttribute('aria-label', option.label + ': ' + percentage + '%'); label.append(bar);
      }
      input.addEventListener('change', () => {
        if (!data.multiple) choices.clear();
        if (input.checked) choices.add(option.id); else choices.delete(option.id);
        if (choices.size > data.maxSelections) { choices.delete(option.id); input.checked = false; status.textContent = 'Можно выбрать не больше ' + data.maxSelections + '.'; }
        else status.textContent = '';
        entry.dirty = true;
        for (const el of form.querySelectorAll('.np-option')) el.classList.toggle('np-selected', el.querySelector('input').checked);
      });
      line.append(label);
      if (!data.anonymous && data.resultsVisible && option.count) {
        const show = button('Кто выбрал', async () => {
          if (line.querySelector('.np-voters')) { line.querySelector('.np-voters').remove(); return; }
          const list = node('div', 'Загрузка…', 'np-voters'); line.append(list);
          async function page(offset = 0) {
            try {
              const result = await api('voters?pollId=' + data.id + '&optionId=' + option.id + '&offset=' + offset);
              if (!offset) list.replaceChildren();
              for (const user of result.users) list.append(node('div', user.name + (user.username ? ' (@' + user.username + ')' : '')));
              if (result.nextOffset !== null) { const next = button('Ещё участники', () => { next.remove(); page(result.nextOffset); }, 'np-link-button'); list.append(next); }
            } catch (error) { list.textContent = error.message; }
          }
          await page();
        }, 'np-link-button'); line.append(show);
      }
      form.append(line);
    }
    const actions = node('div', null, 'np-actions');
    async function cast(selections) {
      if (submitting || entry.busy) return; submitting = true; entry.busy = true;
      const current = epoch;
      for (const control of form.querySelectorAll('button,input')) control.disabled = true;
      status.textContent = 'Сохраняем голос…';
      try {
        const result = await api('vote', { pollId: data.id, selections });
        if (current !== epoch) return;
        entry.data = result; entry.dirty = false; render(entry, selections.length ? 'Голос учтён. Его можно изменить до завершения.' : 'Голос отозван.');
        entry.root.querySelector('.np-primary')?.focus();
      } catch (error) {
        if (current === epoch) { entry.dirty = false; entry.busy = false; await load(entry); const feedback = entry.root.querySelector('[role="status"]'); if (feedback) feedback.textContent = error.message; }
      } finally { submitting = false; entry.busy = false; }
    }
    if (!data.closed) {
      const vote = node('button', data.own.length ? 'Сохранить выбор' : 'Проголосовать', 'np-button np-primary'); vote.type = 'submit'; actions.append(vote);
      if (data.own.length) actions.append(button('Отозвать голос', () => cast([]), 'np-link-button'));
      form.addEventListener('submit', event => { event.preventDefault(); if (!choices.size) { status.textContent = 'Сначала выберите вариант.'; return; } cast([...choices]); });
    }
    form.append(actions, status); root.append(form);
    if (!data.resultsVisible) root.append(node('p', 'Результаты появятся после вашего голоса или завершения опроса.', 'np-note'));
    else if (data.multiple) root.append(node('p', 'Проценты показывают долю участников, выбравших каждый вариант.', 'np-note'));
    const footer = node('div', null, 'np-footer');
    footer.append(node('span', 'Участники · ' + data.total), node('span', data.closed ? 'Голосование завершено' : data.closesAt ? 'До ' + date(data.closesAt) : 'Без срока окончания'));
    root.append(footer);
    const tools = node('div', null, 'np-tools'); tools.append(node('span', 'Автор: ' + data.creator, 'np-note'));
    tools.append(button('Обновить', () => load(entry), 'np-link-button'));
    if (data.canManage && !data.closed) tools.append(button('Завершить', () => {
      if (root.querySelector('.np-confirm')) return;
      const confirm = node('div', null, 'np-confirm'); confirm.append(node('p', 'Завершить опрос? Изменить или добавить голос после этого нельзя.'));
      const yes = button('Завершить опрос', async () => {
        yes.disabled = true; const current = epoch;
        try { const result = await api('close', { pollId: data.id }); if (current === epoch) { entry.data = result; render(entry, 'Опрос завершён.'); } }
        catch (error) { status.textContent = error.message; yes.disabled = false; }
      }); confirm.append(yes, button('Отмена', () => confirm.remove(), 'np-link-button')); root.append(confirm);
    }, 'np-link-button'));
    const link = node('a', 'Ссылка', 'np-link-button'); link.href = '/polls/' + data.id; link.target = '_blank'; link.rel = 'noopener noreferrer'; tools.append(link); root.append(tools);
  }
  function card(id, host, messageId) {
    const root = node('section', 'Загрузка опроса…', 'np-card'); root.setAttribute('aria-label', 'Опрос'); host.append(root);
    const entry = { id, root, messageId, busy: false, dirty: false, data: null }; entries.add(entry); load(entry); return entry;
  }
  async function createPoll() {
    if (account !== identity()) clear();
    createDialog?.close(); createDialog?.remove();
    const dialog = node('dialog', null, 'np-dialog'); createDialog = dialog;
    const header = node('div', null, 'np-dialog-header'); header.append(node('h2', 'Новый опрос'), button('Закрыть', () => { dialog.close(); dialog.remove(); createDialog = null; }, 'np-link-button'));
    const status = node('p', 'Загружаем комнаты…', 'np-status'); status.setAttribute('role', 'status');
    dialog.append(header, status); document.body.append(dialog); dialog.showModal();
    const current = epoch;
    try {
      const result = await api('rooms'); if (current !== epoch || !dialog.open) return;
      const form = node('form');
      function field(label, input) { const wrapper = node('label', label, 'np-field'); wrapper.append(input); return wrapper; }
      const room = node('select'); room.required = true; room.setAttribute('aria-label', 'Комната');
      for (const item of result.rooms) { const option = node('option', (item.t === 'd' ? '@' : '#') + (item.fname || item.name)); option.value = item.rid; room.append(option); }
      const parts = location.pathname.split('/'); const name = decodeURIComponent(parts[2] || '');
      const selected = result.rooms.find(item => item.name === name || item.rid === name); if (selected) room.value = selected.rid;
      const question = node('input'); question.required = true; question.maxLength = 240; question.placeholder = 'Например: когда проведём встречу?';
      const description = node('textarea'); description.maxLength = 1000; description.rows = 2; description.placeholder = 'Контекст или пояснение — необязательно';
      form.append(field('Комната', room), field('Вопрос', question), field('Описание', description));
      const options = node('fieldset', null, 'np-options-editor'); options.append(node('legend', 'Варианты ответа'));
      const rows = node('div'); const inputs = [];
      function updateOptions() {
        inputs.forEach((input, index) => { input.placeholder = 'Вариант ' + (index + 1); input.setAttribute('aria-label', 'Вариант ' + (index + 1)); input.parentElement.querySelector('button').disabled = inputs.length <= 2; });
        add.disabled = inputs.length >= 12;
      }
      function addOption() {
        const line = node('div', null, 'np-edit-option'); const input = node('input'); input.maxLength = 200; input.required = true; inputs.push(input);
        const remove = button('×', () => { inputs.splice(inputs.indexOf(input),1); line.remove(); updateOptions(); }, 'np-remove'); remove.setAttribute('aria-label', 'Удалить вариант');
        line.append(input, remove); rows.append(line); updateOptions(); return input;
      }
      const add = button('+ Добавить вариант', () => addOption().focus(), 'np-link-button');
      options.append(rows, add); form.append(options); addOption(); addOption();
      const settings = node('fieldset', null, 'np-settings'); settings.append(node('legend', 'Настройки'));
      const multiple = node('input'); multiple.type = 'checkbox';
      const maximum = node('input'); maximum.type = 'number'; maximum.min = 1; maximum.max = 12; maximum.value = 2; maximum.disabled = true;
      const limit = field('Максимум вариантов', maximum); limit.hidden = true;
      multiple.addEventListener('change', () => { limit.hidden = !multiple.checked; maximum.disabled = !multiple.checked; });
      const anonymous = node('input'); anonymous.type = 'checkbox'; anonymous.checked = true;
      const results = node('select'); for (const [value, text] of [['after-vote', 'После голосования'], ['always', 'Сразу всем']]) { const option = node('option', text); option.value = value; results.append(option); }
      const deadline = node('select'); for (const [value,text] of [['none','Без срока'],['3600000','Через час'],['86400000','Через сутки'],['604800000','Через неделю'],['custom','Указать дату']]) { const option = node('option',text); option.value = value; deadline.append(option); }
      const custom = node('input'); custom.type = 'datetime-local'; custom.hidden = true;
      deadline.addEventListener('change', () => { custom.hidden = deadline.value !== 'custom'; custom.required = deadline.value === 'custom'; });
      settings.append(field('Несколько вариантов', multiple), limit, field('Анонимный опрос', anonymous), field('Показывать результаты', results), field('Завершение', deadline), custom);
      const note = node('p', 'В анонимном опросе имена участников не показываются. Вопрос и варианты фиксируются при публикации.', 'np-note');
      const publish = node('button', 'Опубликовать опрос', 'np-button np-primary'); publish.type = 'submit';
      form.append(settings, note, publish); dialog.append(form); status.textContent = '';
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (publish.disabled) return; publish.disabled = true; status.textContent = 'Публикуем…';
        try {
          const closesAt = deadline.value === 'none' ? null : deadline.value === 'custom' ? new Date(custom.value).toISOString() : new Date(Date.now() + Number(deadline.value)).toISOString();
          const poll = await api('create', { roomId: room.value, question: question.value, description: description.value, options: inputs.map(input => input.value), multiple: multiple.checked, maxSelections: multiple.checked ? Number(maximum.value) : 1, anonymous: anonymous.checked, results: results.value, closesAt });
          if (current !== epoch || !dialog.open) return;
          form.remove(); status.textContent = 'Опрос опубликован в переписке.';
          const link = node('a', 'Открыть опрос', 'np-button np-primary'); link.href = '/polls/' + poll.id; dialog.append(link);
        } catch (error) { if (current === epoch) { status.textContent = error.message; publish.disabled = false; } }
      });
      question.focus();
    } catch (error) { if (current === epoch) status.textContent = error.message; }
  }
  function enhance() {
    document.querySelectorAll('textarea.js-input-message,[contenteditable="true"].js-input-message').forEach(input => {
      const composer = input.closest('[role="group"]') || input.parentElement;
      if (composer.querySelector('[data-native-poll-create]')) return;
      const create = button('◉ Опрос', createPoll, 'np-launch'); create.dataset.nativePollCreate = 'true'; create.setAttribute('aria-label', 'Создать опрос');
      (composer.querySelector('[role="toolbar"]') || composer).append(create);
    });
    document.querySelectorAll('[data-mid] a[href*="/polls/"]').forEach(link => {
      const message = link.closest('[data-mid]');
      if (!message || message.querySelector('[data-poll-id],.np-card')) return;
      const match = /\/polls\/([\w-]{1,200})\/?$/.exec(new URL(link.href, location.origin).pathname); if (!match) return;
      if (message.dataset.npMismatch === match[1]) return;
      const host = message.querySelector(':scope > .rcx-message-container:not(.rcx-message-container--left)') || message;
      card(match[1], host, message.dataset.mid);
    });
  }
  if (standalone) card(location.pathname.split('/')[2], standalone);
  else {
    let scheduled = false;
    new MutationObserver(() => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; enhance(); }); }).observe(document.body, { childList: true, subtree: true });
    enhance();
  }
  addEventListener('storage', event => { if (['Meteor.userId', 'Meteor.loginToken'].includes(event.key)) clear(); });
  setInterval(() => {
    if (account !== identity()) clear();
    if (document.visibilityState !== 'visible') return;
    for (const entry of entries) {
      if (!entry.root.isConnected) { entries.delete(entry); continue; }
      const rect = entry.root.getBoundingClientRect();
      if (!entry.dirty && !entry.root.contains(document.activeElement) && rect.bottom > 0 && rect.top < innerHeight) load(entry, true);
    }
  }, 15000);
})();
