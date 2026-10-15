export type Appearance = { mode: 'light' | 'dark' | 'device'; accent: 'teal' | 'blue' | 'violet' };
export function appearance(): Appearance {
  const root = document.documentElement;
  return {
    mode: (root.dataset.mode ?? 'light') as Appearance['mode'],
    accent: (root.dataset.accent ?? 'teal') as Appearance['accent'],
  };
}
function apply(value: Appearance) {
  const root = document.documentElement;
  root.dataset.mode = value.mode;
  root.dataset.accent = value.accent;
  root.dataset.theme =
    value.mode === 'device'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : value.mode;
}
export function setAppearance(value: Appearance) {
  apply(value);
  try {
    localStorage.setItem('medi.appearance', JSON.stringify(value));
  } catch {
    /* Applies in memory when storage is blocked. */
  }
  window.dispatchEvent(new Event('medi-appearance'));
}
export function initializeAppearance() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => apply(appearance()));
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== 'medi.appearance') return;
    let value: Partial<Appearance> = {};
    try {
      value = JSON.parse(event.newValue ?? '{}') ?? {};
    } catch {
      /* Default invalid preferences. */
    }
    apply({
      mode: ['light', 'dark', 'device'].includes(value.mode ?? '') ? value.mode! : 'light',
      accent: ['teal', 'blue', 'violet'].includes(value.accent ?? '') ? value.accent! : 'teal',
    });
    window.dispatchEvent(new Event('medi-appearance'));
  });
}
