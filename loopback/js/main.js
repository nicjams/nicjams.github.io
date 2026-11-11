// Boot as the station (the computer with the mixer: it records and plays) or,
// with ?pair=<room> in the address, as a remote for that station (an iPad).
// A browser that can't record where it is (an iPad that opened the computer's
// address over plain http) is a remote too, and asks serve.py for the room.

import { Looper } from './looper.js';
import { UI } from './ui.js';
import { Host, Remote, newRoom, validRoom } from './link.js';
import { PeakMirror, quantize } from './view.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const epoch = () => (performance.timeOrigin + performance.now()) / 1000;

// Commands a remote may send. The rest (devices, files, downloads) belong to
// the station's own screen.
const REMOTE_COMMANDS = new Set(['pedal', 'play', 'stop', 'metronome', 'set', 'demo', 'name', 'chord', 'scaleBars',
  'redetect', 'save', 'new', 'load', 'delete', 'takePlay', 'takeKeep', 'takeDelete', 'calibrate', 'input', 'hello']);

let wakeLock = null;
async function stayAwake() {
  try { if (!wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeLock === null && stayAwake.wanted) stayAwake(); });

const pair = params.get('pair');
const canRecord = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
if (pair && validRoom(pair)) startRemote(pair);
else if (canRecord || params.has('virtual')) startStation();
else findStation();

// ---- the station --------------------------------------------------------------------

function startStation() {
  const looper = new Looper({ virtual: params.has('virtual') });
  const engine = looper.engine;
  let room = localStorage.getItem('loopback:room');
  if (!validRoom(room)) { room = newRoom(); localStorage.setItem('loopback:room', room); }

  let host, hostStatus = { cloud: 'off', remotes: 0 };
  const makeHost = () => {
    host = new Host({
      room,
      heard: () => (engine.ctx ? engine.heard() : 0),
      onCommand: (cmd, args) => {
        if (!REMOTE_COMMANDS.has(cmd) || (cmd === 'set' && ['deviceId', 'outputId'].includes(args.key))) return;
        looper.dispatch(cmd, args);
      },
    });
    host.onStatus((s) => { hostStatus = s; renderPair(); });
    if (latest) host.publish(latest);
  };
  let latest = null;
  makeHost();
  if (localStorage.getItem('loopback:pairing') === 'on') host.startCloud();

  const download = async (takeId) => {
    const file = await looper.wav(takeId);
    if (!file) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file.blob);
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const fillDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const fill = (sel, kind, none, current) => {
      const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications');
      sel.replaceChildren(new Option(none, ''), ...list.map((d, i) => new Option(d.label || `${kind === 'audioinput' ? 'Input' : 'Output'} ${i + 1}`, d.deviceId)));
      sel.value = list.some((d) => d.deviceId === current) ? current : '';
    };
    const s = looper.settings;
    fill($('deviceSel'), 'audioinput', 'Default input', s.deviceId);
    fill($('outputSel'), 'audiooutput', 'System default', s.outputId);
    $('outputField').hidden = !('setSinkId' in AudioContext.prototype);
  };

  const ui = new UI({
    role: 'station',
    send: (cmd, args, ev) => looper.dispatch(cmd, args, ev),
    clock: (ev) => (engine.ctx ? (ev ? engine.eventTime(ev) : engine.heard()) : null),
    peaks: engine,
    station: { looper, download, fillDevices },
  });
  looper.onState((s) => { latest = s; ui.render(s); host.publish(s); stayAwake.wanted = s.phase !== 'empty'; if (stayAwake.wanted) stayAwake(); });
  looper.onMeter((first, peaks) => {
    let m = 0;
    for (const p of peaks) if (p > m) m = p;
    ui.meter(m);
    host.meter(first, Array.from(peaks, quantize));
  });

  // A remote's commands can only make sound once this page has been clicked.
  const unlock = () => {
    if (engine.running) return;
    engine.start().then(() => looper.emit()).catch(() => {});
  };
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });

  $('inputBtn').addEventListener('click', () => looper.dispatch('input'));
  $('fileIn').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file && ui.okToReplace()) looper.importFile(file).catch((err) => looper.say(err.message, 'error'));
  });
  $('wavBtn').addEventListener('click', () => download());
  $('latency').addEventListener('change', (e) => looper.setLatency((+e.target.value || 0) / 1000));
  $('deviceSel').addEventListener('change', (e) => looper.dispatch('set', { key: 'deviceId', value: e.target.value }));
  $('outputSel').addEventListener('change', (e) => looper.dispatch('set', { key: 'outputId', value: e.target.value }));
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { if ($('settings').open) fillDevices(); });

  // ---- pairing ----
  function base() {
    const v = $('pairBase').value.trim();
    try { return new URL(v || './', location.href); } catch { return new URL('./', location.href); }
  }
  function isLocal(u) { return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); }
  $('pairBase').value = new URL('./', location.href).href;
  function renderPair() {
    const s = hostStatus, on = s.cloud !== 'off';
    const url = new URL(base().href);
    url.search = `?pair=${room}`;
    $('pairLink').href = url.href;
    $('pairLink').textContent = url.href;
    const local = isLocal(url);
    $('pairBaseField').hidden = !isLocal(new URL(location.href));
    $('pairQr').hidden = local || s.cloud !== 'online';
    if (!$('pairQr').hidden) {
      const src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(url.href)}`;
      if ($('pairQr').src !== src) $('pairQr').src = src;
    }
    const remotes = s.remotes ? `${s.remotes} ${s.remotes === 1 ? 'remote' : 'remotes'} connected${s.direct ? ' (direct)' : ''}` : 'Waiting for the iPad…';
    $('pairStatus').textContent = {
      off: 'Pairing is off.', connecting: 'Starting pairing…', online: remotes,
      offline: 'Pairing offline — reconnecting…', error: `Pairing failed: ${s.error}`,
    }[s.cloud] || '';
    $('pairHint').textContent = local
      ? 'An iPad can’t reach “localhost”. Put this computer’s Wi-Fi address above (for example http://192.168.1.20:8931/loopback/), or use the published site.'
      : 'Anyone with this link can control this looper — keep it to yourself.';
    $('pairOff').hidden = !on;
    $('pairDot').dataset.state = s.remotes ? 'live' : s.cloud === 'online' ? 'ready' : s.cloud === 'error' ? 'error' : on ? 'busy' : 'off';
    $('pairLabel').textContent = s.remotes ? 'iPad connected' : 'iPad';
  }
  // Tell serve.py which room we're pairing in, so an iPad that just opens this
  // computer's address can find it. Its answer has that address, for the link.
  function announce() {
    if (!isLocal(new URL(location.href))) return;
    const on = localStorage.getItem('loopback:pairing') === 'on';
    fetch('station', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(on ? { room } : { room: null, was: room }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info?.lan && $('pairBase').value === new URL('./', location.href).href) { $('pairBase').value = info.lan; renderPair(); }
      })
      .catch(() => {});
  }
  $('pairQr').addEventListener('error', () => { $('pairQr').hidden = true; });
  $('pairBase').addEventListener('input', renderPair);
  $('pairBtn').addEventListener('click', () => {
    localStorage.setItem('loopback:pairing', 'on');
    host.startCloud();
    announce();
    renderPair();
    $('pairDlg').showModal();
  });
  $('pairCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('pairLink').href); ui.toast('Link copied'); } catch { ui.toast('Select the link and copy it', 'error'); }
  });
  $('pairNew').addEventListener('click', () => {
    if (!confirm('Make a new link? Remotes using the old one will stop working.')) return;
    host.close();
    room = newRoom();
    localStorage.setItem('loopback:room', room);
    makeHost();
    host.startCloud();
    announce();
  });
  $('pairOff').addEventListener('click', () => {
    localStorage.setItem('loopback:pairing', 'off');
    host.stopCloud();
    announce();
  });
  renderPair();
  if (localStorage.getItem('loopback:pairing') === 'on') announce();

  if (params.has('demo')) looper.dispatch('demo', { index: Math.max(0, +params.get('demo') || 0) });
  if (params.has('virtual')) window.looper = looper;   // for poking at in tests
}

// ---- a remote ---------------------------------------------------------------------

/** Ask serve.py for the room the station is pairing in, waiting for it if
 *  pairing isn't on yet; without serve.py, say how to pair instead. */
async function findStation() {
  document.body.classList.add('remote', 'connecting');
  $('pairBtn').hidden = true;
  $('inputLabel').textContent = 'Not connected';
  const say = (text) => { $('centerBig').textContent = ''; $('centerSub').textContent = text; };
  say('Looking for the computer…');
  for (;;) {
    let r = null, info = null;
    try { r = await fetch('station', { cache: 'no-store' }); if (r.ok) info = await r.json(); } catch {}
    if (r && !r.ok) { say('This browser can’t record here. To use it as a remote, open Loopback on the computer, press iPad and scan the code.'); return; }
    if (validRoom(info?.room)) { startRemote(info.room); return; }
    say(info ? 'Open Loopback on the computer and press iPad' : 'Can’t reach the computer — trying again…');
    await new Promise((res) => setTimeout(res, 2000));
  }
}

function startRemote(room) {
  const mirror = new PeakMirror();
  let fallback = null, ui = null, first = true;
  const remote = new Remote({
    room,
    cloudOnly: params.get('via') === 'cloud',
    onState: (s) => {
      if (remote.offset === null && s.at) fallback = s.at - epoch();
      ui.render(s);
      if (first) { first = false; document.body.classList.remove('connecting'); }
    },
    onMeter: (b, bytes) => {
      mirror.push(b, bytes);
      let m = 0;
      for (const q of bytes) if (q > m) m = q;
      ui.meter((m / 255) ** 2);
    },
  });
  const clock = (ev) => {
    const c = remote.clock(ev);
    if (c !== null) return c;
    if (fallback === null) return null;
    return (ev?.timeStamp ? (performance.timeOrigin + ev.timeStamp) / 1000 : epoch()) + fallback;
  };
  ui = new UI({
    role: 'remote',
    send: (cmd, args) => { try { remote.send(cmd, args); } catch (err) { ui.toast(err.message, 'error'); } },
    // only time a press on the station's clock when the sync is tight
    clock: (ev) => (ev ? (remote.status().rtt !== null && remote.status().rtt < 0.06 ? remote.clock(ev) : null) : clock()),
    peaks: mirror,
  });
  document.body.classList.add('connecting');
  $('centerBig').textContent = '';
  $('centerSub').textContent = 'Connecting to the computer…';

  let rechecking = false;
  remote.onStatus((s) => {
    const text = {
      direct: `Connected${s.rtt !== null ? ` · ${Math.round(s.rtt * 1000)} ms` : ''}`,
      local: 'Connected (this browser)',
      cloud: s.host ? 'Connected via the cloud (slower)' : 'Computer not connected',
      none: s.cloud === 'error' ? 'Can’t reach the pairing service' : 'Connecting…',
    }[s.route];
    $('inputLabel').textContent = text;
    $('inputBtn').classList.toggle('on', s.route === 'direct' || s.route === 'local');
    $('remoteStatus').textContent = `${text}.${s.route === 'cloud' && s.host ? ' Taps take a moment to arrive this way; the loop timing on the computer is unaffected.' : ''}${s.error ? ` ${s.error}` : ''}`;
    if (first && s.route !== 'none' && s.host === false) $('centerSub').textContent = 'Open Loopback on the computer and turn on iPad pairing';
    // Served by serve.py, and the computer's gone: it may have made a new link,
    // or another browser on it may be pairing now. Look for it afresh.
    if (s.route !== 'none' && s.host === false && !rechecking) {
      rechecking = true;
      fetch('station', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
        .then((info) => { if (validRoom(info?.room) && info.room !== room) location.replace(location.pathname); })
        .catch(() => {})
        .finally(() => setTimeout(() => { rechecking = false; }, 5000));
    }
  });
  $('inputBtn').addEventListener('click', () => $('pairDlg').showModal());
  $('inputBtn').querySelector('svg').innerHTML =
    '<path d="M2 6.2a8.5 8.5 0 0 1 12 0M4.3 8.6a5.2 5.2 0 0 1 7.4 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.6" r="1.4" fill="currentColor"/>';
  $('pairBtn').hidden = true;
  $('latency').readOnly = true;
  $('latency').title = 'Set on the computer';
  remote.start();
  stayAwake.wanted = true;
  document.addEventListener('pointerdown', () => stayAwake(), { once: true });
}
