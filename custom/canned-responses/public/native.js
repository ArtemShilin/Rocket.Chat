(() => {
  if (window.__localCannedBridge) return;
  window.__localCannedBridge = true;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/local-canned-responses/style.css'; document.head.append(style);
  const script = document.createElement('script'); script.src = '/local-canned-responses/app.js'; document.head.append(script);
})();
