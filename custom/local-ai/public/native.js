(() => {
  if (window.__localAISearchBridge) return;
  window.__localAISearchBridge = true;
  const searchInput = container => container?.querySelector('input[aria-keyshortcuts*="Control+K"]');
  const label = 'AI-поиск по всей истории';
  const isAI = button => button?.matches('[data-local-ai-button]') || Boolean(button?.querySelector('.rcx-icon--name-stars, [name="stars"]'));
  function enhance() {
    document.querySelectorAll('[role="search"]').forEach(container => {
      const input = searchInput(container);
      if (!input) return;
      const fallback = container.querySelector('[data-local-ai-button]');
      let button = [...container.querySelectorAll('button')].find(item => isAI(item) && item !== fallback) || fallback;
      if (button && button !== fallback) fallback?.remove();
      if (!button) {
        button = document.createElement('button'); button.type = 'button';
        button.dataset.localAiButton = 'true'; button.textContent = '✦';
        button.className = 'rcx-button--icon rcx-button--small-square';
        button.style.cssText = 'flex-shrink:0;cursor:pointer;border:0;background:transparent;color:inherit;padding:6px;font-size:18px';
        (container.querySelector('.rcx-input-box__addon') || container).append(button);
      }
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      if (button.title !== label) button.title = label;
    });
  }
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    const container = button?.closest('[role="search"]');
    if (!searchInput(container) || !isAI(button)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const query = searchInput(container)?.value.trim() || '';
    window.open('/local-ai' + (query ? '#q=' + encodeURIComponent(query) : ''), '_blank', 'noopener,noreferrer');
  }, true);
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhance(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
  enhance();
})();
