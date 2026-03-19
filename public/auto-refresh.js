(() => {
  const body = document.body;
  if (!body) {
    return;
  }

  const watchEndpoint = (body.dataset.watchEndpoint || '').trim();
  const initialVersion = String(body.dataset.watchVersion || '0');
  const pollMs = Number(body.dataset.watchPollMs || 1500);
  if (!watchEndpoint || !Number.isFinite(pollMs) || pollMs < 500) {
    return;
  }

  const indicator = document.getElementById('auto-refresh-indicator');
  let latestVersion = initialVersion;
  let pendingReload = false;
  let inFlight = false;

  function isUserEditing() {
    const active = document.activeElement;
    if (!active) {
      return false;
    }
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return true;
    }
    if (active.isContentEditable) {
      return true;
    }
    return false;
  }

  function isModalOpen() {
    return Boolean(document.querySelector('.modal-shell:not([hidden])'));
  }

  function shouldPause() {
    return document.hidden || isUserEditing() || isModalOpen();
  }

  function updateIndicator(text) {
    if (indicator) {
      indicator.textContent = text;
    }
  }

  function triggerReload() {
    updateIndicator('检测到新内容，刷新中...');
    window.location.reload();
  }

  async function pollOnce() {
    if (inFlight) {
      return;
    }

    if (shouldPause()) {
      updateIndicator(pendingReload ? '检测到新内容，待你操作后刷新' : '实时监测暂停中');
      return;
    }

    inFlight = true;
    try {
      const separator = watchEndpoint.includes('?') ? '&' : '?';
      const response = await fetch(
        `${watchEndpoint}${separator}since=${encodeURIComponent(latestVersion)}&_=${Date.now()}`,
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`watch endpoint status ${response.status}`);
      }

      const payload = await response.json();
      const currentVersion = String(payload.version ?? latestVersion);
      const changed = Boolean(payload.changed) || currentVersion !== latestVersion;

      if (changed) {
        latestVersion = currentVersion;
        if (shouldPause()) {
          pendingReload = true;
          updateIndicator('检测到新内容，待你操作后刷新');
          return;
        }
        triggerReload();
        return;
      }

      pendingReload = false;
      updateIndicator('实时监测中');
    } catch (error) {
      updateIndicator('监测失败，自动重试中');
    } finally {
      inFlight = false;
    }
  }

  updateIndicator('实时监测中');
  setInterval(pollOnce, pollMs);

  window.addEventListener('focus', () => {
    if (pendingReload && !shouldPause()) {
      triggerReload();
      return;
    }
    pollOnce();
  });

  document.addEventListener('visibilitychange', () => {
    if (pendingReload && !shouldPause()) {
      triggerReload();
      return;
    }
    if (!document.hidden) {
      pollOnce();
    }
  });

  window.addEventListener('pageshow', () => {
    pendingReload = false;
    pollOnce();
  });
})();
