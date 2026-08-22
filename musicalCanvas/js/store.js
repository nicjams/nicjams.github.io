/*
 * Set storage. Talks to server.py when it is running, and falls back to
 * localStorage so the canvas still works off a plain static server.
 */

const LS_KEY = 'musicalCanvas.sets';
const API = 'api/sets';         // relative: resolves under whatever path serves the app

const lsAll = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch (e) { return {}; }
};
const lsWrite = obj => localStorage.setItem(LS_KEY, JSON.stringify(obj));

export class Store {
  constructor() {
    this.online = false;
  }

  async ping() {
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      this.online = r.ok;
    } catch (e) {
      this.online = false;
    }
    return this.online;
  }

  async list() {
    if (this.online) {
      try {
        const r = await fetch(API, { cache: 'no-store' });
        if (r.ok) return (await r.json()).sets;
      } catch (e) { this.online = false; }
    }
    return Object.values(lsAll())
      .map(s => ({
        id: s.id,
        name: s.name,
        updated_at: s.updated_at,
        bpm: s.settings?.bpm,
        bars: s.settings?.bars,
        notes: (s.notes || []).length,
        strokes: (s.strokes || []).length,
      }))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }

  async save(payload, id = null) {
    if (this.online) {
      try {
        const r = await fetch(id ? `${API}/${id}` : API, {
          method: id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (r.ok) return await r.json();
        if (r.status === 404 && id) return this.save(payload, null);
      } catch (e) { this.online = false; }
    }
    const all = lsAll();
    const sid = id || 'local-' + Date.now().toString(36);
    all[sid] = { ...payload, id: sid, updated_at: new Date().toISOString() };
    lsWrite(all);
    return all[sid];
  }

  async load(id) {
    if (this.online && !String(id).startsWith('local-')) {
      try {
        const r = await fetch(`${API}/${id}`, { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch (e) { this.online = false; }
    }
    return lsAll()[id] || null;
  }

  async remove(id) {
    if (this.online && !String(id).startsWith('local-')) {
      try {
        const r = await fetch(`${API}/${id}`, { method: 'DELETE' });
        if (r.ok) return true;
      } catch (e) { this.online = false; }
    }
    const all = lsAll();
    delete all[id];
    lsWrite(all);
    return true;
  }
}
