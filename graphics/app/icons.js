// icons.js — small inline SVG icons for buttons (no emoji glyphs).
// Each is a 24×24 viewBox drawn in currentColor, so it takes the button's text color.
// Use `iconize(root)` to fill every `[data-icon]` element under root.

const line = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const solid = (d) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  prev: solid('<rect x="5" y="5" width="2.4" height="14" rx="1"/><path d="M19 5.8v12.4a.9.9 0 0 1-1.4.75L9.2 12.75a.9.9 0 0 1 0-1.5l8.4-6.2a.9.9 0 0 1 1.4.75z"/>'),
  next: solid('<rect x="16.6" y="5" width="2.4" height="14" rx="1"/><path d="M5 5.8v12.4a.9.9 0 0 0 1.4.75l8.4-6.2a.9.9 0 0 0 0-1.5L6.4 5.05A.9.9 0 0 0 5 5.8z"/>'),
  play: solid('<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/>'),
  pause: solid('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>'),
  back: line('<path d="M10 7 5 12l5 5"/><path d="M5 12h9.5a4.5 4.5 0 0 1 0 9H12"/>'),
  sliders: line('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
  remote: line('<rect x="7" y="2.5" width="10" height="19" rx="2.6"/><path d="M11 18.2h2"/>'),
  fullscreen: line('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'),
  reload: line('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>'),
  copy: line('<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  up: line('<path d="m6 15 6-6 6 6"/>'),
  down: line('<path d="m6 9 6 6 6-6"/>'),
  close: line('<path d="M6 6l12 12M18 6 6 18"/>'),
};

/** Parse an icon into an element (for use with util.el). */
export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name] || '';
  return t.content.firstElementChild;
}

/** Fill every `[data-icon]` element under `root` with its icon (before any label text). */
export function iconize(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    if (!node.querySelector(':scope > svg')) node.insertAdjacentHTML('afterbegin', ICONS[node.dataset.icon] || '');
  }
}
