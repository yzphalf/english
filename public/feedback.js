(() => {
  const toastEl = document.createElement('div');
  toastEl.className = 'interaction-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastEl);

  let toastTimer = null;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-visible');
    }, 1800);
  }

  function setButtonLoading(button, loadingText) {
    if (!button || button.dataset.loadingBound === '1') {
      return;
    }
    button.dataset.loadingBound = '1';
    button.dataset.originalText = button.textContent.trim();
    button.dataset.loadingText = loadingText || button.dataset.loadingText || '处理中...';
  }

  document.querySelectorAll('form').forEach((form) => {
    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!submitButton) {
      return;
    }
    setButtonLoading(submitButton);

    form.addEventListener('submit', () => {
      if (submitButton.tagName === 'BUTTON') {
        submitButton.classList.add('is-loading');
      }
      submitButton.disabled = true;
      submitButton.textContent = submitButton.dataset.loadingText || '处理中...';
    });
  });

  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      const selector = button.getAttribute('data-copy-target');
      const target = selector ? document.querySelector(selector) : null;
      const text = target ? (target.textContent || '').trim() : '';
      if (!text) {
        showToast('没有可复制的内容');
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        showToast(button.getAttribute('data-copy-success') || '已复制');
      } catch (_) {
        showToast('复制失败，请手动复制');
      }
    });
  });

  document.querySelectorAll('a.topic-card-link, a.back-link').forEach((link) => {
    link.addEventListener('click', () => {
      link.classList.add('is-pending');
    });
  });

  window.__uiFeedback = {
    toast: showToast
  };
})();
