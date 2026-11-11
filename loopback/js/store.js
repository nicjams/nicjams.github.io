// Saved loops and takes live in this browser's IndexedDB. Metadata and audio
// are kept in separate stores so the library can list everything without
// loading any sound; audio is 16-bit PCM at the rate it was recorded.

const DB = 'loopback', VERSION = 1;
let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('loops', { keyPath: 'id' });
        db.createObjectStore('takes', { keyPath: 'id' }).createIndex('loopId', 'loopId');
        db.createObjectStore('audio');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return opening;
}

function run(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(tx)).then((r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function listLoops() {
  const loops = await run(['loops'], 'readonly', (tx) => req(tx.objectStore('loops').getAll()));
  return loops.sort((a, b) => b.updated - a.updated);
}

export function listTakes(loopId) {
  return run(['takes'], 'readonly', (tx) => req(tx.objectStore('takes').index('loopId').getAll(loopId)))
    .then((takes) => takes.sort((a, b) => b.created - a.created));
}

export function countTakes() {
  return run(['takes'], 'readonly', async (tx) => {
    const counts = {};
    for (const t of await req(tx.objectStore('takes').getAll())) counts[t.loopId] = (counts[t.loopId] || 0) + 1;
    return counts;
  });
}

/** Save a loop's metadata, and its audio when `pcm` is given. */
export function saveLoop(meta, pcm) {
  return run(['loops', 'audio'], 'readwrite', (tx) => {
    tx.objectStore('loops').put(meta);
    if (pcm) tx.objectStore('audio').put(pcm, 'loop:' + meta.id);
  });
}

export function saveTake(meta, pcm) {
  return run(['takes', 'audio'], 'readwrite', (tx) => {
    tx.objectStore('takes').put(meta);
    if (pcm) tx.objectStore('audio').put(pcm, 'take:' + meta.id);
  });
}

export function loadAudio(kind, id) {
  return run(['audio'], 'readonly', (tx) => req(tx.objectStore('audio').get(kind + ':' + id)));
}

export function deleteTake(id) {
  return run(['takes', 'audio'], 'readwrite', (tx) => {
    tx.objectStore('takes').delete(id);
    tx.objectStore('audio').delete('take:' + id);
  });
}

export function deleteLoop(id) {
  return run(['loops', 'takes', 'audio'], 'readwrite', async (tx) => {
    tx.objectStore('loops').delete(id);
    tx.objectStore('audio').delete('loop:' + id);
    for (const key of await req(tx.objectStore('takes').index('loopId').getAllKeys(id))) {
      tx.objectStore('takes').delete(key);
      tx.objectStore('audio').delete('take:' + key);
    }
  });
}

/** Ask the browser not to clear saved loops when it runs short of space. */
export function persist() {
  return navigator.storage?.persist?.().catch(() => false);
}
