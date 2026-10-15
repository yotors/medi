(() => {
  let value = {};
  try {
    value = JSON.parse(localStorage.getItem('medi.appearance') || '{}') || {};
  } catch {}
  const mode = ['light', 'dark', 'device'].includes(value.mode) ? value.mode : 'light';
  const accent = ['teal', 'blue', 'violet'].includes(value.accent) ? value.accent : 'teal';
  const root = document.documentElement;
  root.dataset.mode = mode;
  root.dataset.theme =
    mode === 'device'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : mode;
  root.dataset.accent = accent;
})();
