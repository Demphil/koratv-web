(() => {
  let initialized = false;
  window.addEventListener('message', (event) => {
    if (initialized || event.source !== parent || event.data?.type !== 'koratv-ad-slot' || window === parent) return;
    const config = event.data.config;
    let url;
    try { url = new URL(config.script_url); } catch { return; }
    if (url.protocol !== 'https:' || url.username || url.password) return;
    initialized = true;
    const root = document.getElementById('ad-root');
    if (/^[a-zA-Z][\w-]{0,100}$/.test(config.container_id || '')) root.id = config.container_id;
    if (config.at_options && typeof config.at_options === 'object') window.atOptions = config.at_options;
    const script = document.createElement('script');
    script.src = url.href;
    script.async = true;
    script.dataset.cfasync = 'false';
    document.body.append(script);
  });
})();
