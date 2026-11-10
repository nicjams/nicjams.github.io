// Each visualization is its own page by default (e.g. graphics/gameOfLife/).
// Add ?stage=1 to open it inside the studio stage instead.
(() => {
  if (window.self !== window.top) return;
  const url = new URL(location.href);
  if (!url.searchParams.has('stage')) return;
  const id = url.pathname.split('/').filter(Boolean).filter(p => p !== 'index.html').pop();
  const target = new URL('../stage.html', url);
  target.search = url.search;
  target.searchParams.delete('stage');
  target.searchParams.set('viz', id);
  location.replace(target.href);
})();
