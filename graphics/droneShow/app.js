import { PRESETS, makeFormation } from './formations.js';

const $ = (id) => document.getElementById(id);
const canvas = $('showCanvas'), ctx = canvas.getContext('2d');
const grid = $('presetGrid'), filters = $('filters');
const palettes = {
  aurora: ['#d9ff9b', '#8af1d0', '#b5b6ff', '#f3c6ff'],
  warm: ['#fff0ba', '#ffd180', '#ff9e83', '#ffe9bb'],
  ice: ['#b7faff', '#78caff', '#dbeaff', '#9ff2ed'],
  candy: ['#ffaccf', '#e7b5ff', '#a6d9ff', '#ffd4b1'],
  rainbow: ['#ff8d96', '#ffd17c', '#e0f98e', '#8be5de', '#a9afff', '#ecadf6'],
  white: ['#ffffff', '#e4edff', '#fff6da']
};
let current = 0, category = 'All', drones = [], width = 0, height = 0, dpr = 1;
let transitionStart = performance.now(), autoplayAt = 0, playing = false, lastTime = 0;
const stars = Array.from({length: 130}, (_, i) => ({x: hash(i * 3 + 1), y: hash(i * 3 + 2) * .78, r: .3 + hash(i * 3 + 3) * 1.1, phase: hash(i + 400) * 6}));
function hash(n) { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }
function ease(t) { return t < .5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
function position(d, t) { const p = ease(Math.max(0, Math.min(1, (t-transitionStart)/(Number($('speed').value)*1000)))); return [d.from[0]+(d.to[0]-d.from[0])*p, d.from[1]+(d.to[1]-d.from[1])*p]; }
function assignFormation(index, immediate = false) {
  current = (index + PRESETS.length) % PRESETS.length;
  const now = performance.now(), targets = makeFormation(PRESETS[current].id, Number($('droneCount').value));
  const old = drones.map(d => position(d, now));
  // Assign each existing drone to a nearby available point to make the movement feel choreographed.
  const available = targets.map((point, i) => ({point, i}));
  drones = targets.map((_, i) => {
    const from = old[i] || [Math.cos(i*2.4)*.03, -.92 + hash(i)*.03];
    let best = 0, distance = Infinity;
    for (let j=0; j<available.length; j++) { const dx=from[0]-available[j].point[0], dy=from[1]-available[j].point[1], d=dx*dx+dy*dy; if(d<distance){distance=d;best=j;} }
    const target = available.splice(best,1)[0].point;
    return {from: immediate ? target : from, to: target, phase: hash(i+20)*6, color: hash(i+200)};
  });
  transitionStart = now; autoplayAt = now + (Number($('speed').value)+3.5)*1000;
  const preset = PRESETS[current];
  $('currentName').textContent = preset.name; $('currentDescription').textContent = preset.description;
  $('formationNumber').textContent = `${String(current+1).padStart(2,'0')} / ${String(PRESETS.length).padStart(2,'0')}`;
  $('droneReadout').textContent = drones.length;
  document.querySelectorAll('.preset').forEach(el => { const selected = Number(el.dataset.index) === current; el.classList.toggle('active', selected); el.setAttribute('aria-pressed', String(selected)); });
}
function makeThumb(c, preset) {
  const x = c.getContext('2d'), w = c.width, h = c.height;
  x.clearRect(0,0,w,h); const points = makeFormation(preset.id, 75);
  x.fillStyle = '#bfecc4';
  for (const [px,py] of points) { x.globalAlpha = .55 + hash(Math.round((px+2)*100+py*31))*.45; x.beginPath(); x.arc(w/2+px*w*.34,h/2-py*h*.38,1,0,Math.PI*2); x.fill(); }
  x.globalAlpha = 1;
}
function renderLibrary() {
  const query = $('search').value.trim().toLowerCase(); grid.replaceChildren();
  PRESETS.forEach((p,i) => {
    if ((category !== 'All' && p.category !== category) || !`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(query)) return;
    const b=document.createElement('button'); b.className='preset'+(i===current?' active':''); b.dataset.index=i; b.setAttribute('aria-pressed',String(i===current)); b.title=p.description;
    const c=document.createElement('canvas'); c.className='preset-preview'; c.width=120;c.height=70;
    const name=document.createElement('span'); name.className='preset-label'; name.textContent=p.name; b.append(c,name); b.addEventListener('click',()=>assignFormation(i)); grid.append(b); makeThumb(c,p);
  });
  $('empty').hidden = grid.children.length > 0;
}
function renderFilters() {
  filters.replaceChildren();
  ['All',...new Set(PRESETS.map(p=>p.category))].forEach(cat=>{const b=document.createElement('button');b.textContent=cat.toUpperCase();b.className=cat===category?'active':'';b.setAttribute('aria-pressed',String(cat===category));b.addEventListener('click',()=>{category=cat;renderFilters();renderLibrary();});filters.append(b);});
}
function resize(){ const box=canvas.getBoundingClientRect();width=box.width;height=box.height;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0); }
function draw(now){
  if(!width||!height) resize();
  const dt = Math.min(50, now-lastTime || 16); lastTime=now;
  ctx.clearRect(0,0,width,height);
  const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,'#080e1b');sky.addColorStop(.68,'#101f30');sky.addColorStop(1,'#24333a');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
  const glow=ctx.createRadialGradient(width*.54,height*.63,0,width*.54,height*.63,width*.55);glow.addColorStop(0,'rgba(78,102,108,.14)');glow.addColorStop(1,'rgba(7,13,25,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
  for(const s of stars){ctx.fillStyle=`rgba(206,225,234,${.15+.35*(.5+.5*Math.sin(now*.0005+s.phase))})`;ctx.beginPath();ctx.arc(s.x*width,s.y*height,s.r,0,Math.PI*2);ctx.fill();}
  // Low horizon silhouettes ground the show without obscuring the formation.
  ctx.fillStyle='#0b1520';ctx.beginPath();ctx.moveTo(0,height*.86);for(let x=0;x<=width+20;x+=20){ctx.lineTo(x,height*(.86 + .012*Math.sin(x*.009)+.009*Math.sin(x*.024+1)));}ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.fill();
  ctx.fillStyle='#080f19';ctx.beginPath();ctx.moveTo(0,height*.91);for(let x=0;x<=width+15;x+=15){ctx.lineTo(x,height*(.91+.009*Math.sin(x*.013+2)+.006*Math.sin(x*.04)));}ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.fill();
  const scale=Math.min(width*.34,height*.34), cx=width*.51, cy=height*.42, colors=palettes[$('palette').value];
  const progress=Math.max(0,Math.min(1,(now-transitionStart)/(Number($('speed').value)*1000)));
  $('statusReadout').textContent = progress < 1 ? 'IN FLIGHT' : 'HOLDING';
  drones.forEach((d,i)=>{
    const [x,y]=position(d,now), px=cx+x*scale, py=cy-y*scale;
    const color=colors[Math.min(colors.length-1,Math.floor(d.color*colors.length))];
    if($('trails').checked && progress<.99){const prev=position(d,now-Math.max(90,dt*5));ctx.strokeStyle=color;ctx.globalAlpha=.12;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx+prev[0]*scale,cy-prev[1]*scale);ctx.lineTo(px,py);ctx.stroke();}
    ctx.globalAlpha=.13;ctx.fillStyle=color;ctx.beginPath();ctx.arc(px,py,5.2,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=.75+.25*Math.sin(now*.002+d.phase);ctx.beginPath();ctx.arc(px,py,1.6,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=.9;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(px,py,.65,0,Math.PI*2);ctx.fill();
  });ctx.globalAlpha=1;
  if(playing && now>=autoplayAt) assignFormation(current+1);
  requestAnimationFrame(draw);
}
function setPlaying(value){playing=value;$('autoplay').checked=value;$('playBtn').innerHTML=value?'❚❚ <span>PAUSE THE SHOW</span>':'▶ <span>PLAY THE SHOW</span>';if(value)autoplayAt=performance.now()+1000;}
$('search').addEventListener('input',renderLibrary);
$('droneCount').addEventListener('input',()=>{$('countValue').textContent=`${$('droneCount').value} drones`;assignFormation(current);});
$('speed').addEventListener('input',()=>{$('speedValue').textContent=`${Number($('speed').value).toFixed(1)} s`;});
$('autoplay').addEventListener('change',e=>setPlaying(e.target.checked));
$('playBtn').addEventListener('click',()=>setPlaying(!playing));
$('prevBtn').addEventListener('click',()=>assignFormation(current-1));$('nextBtn').addEventListener('click',()=>assignFormation(current+1));
$('fullscreenBtn').addEventListener('click',()=>{if(document.fullscreenElement) document.exitFullscreen(); else document.querySelector('.sky').requestFullscreen?.();});
window.addEventListener('resize',resize);
window.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;if(e.key===' '){e.preventDefault();setPlaying(!playing);}else if(e.key==='n')assignFormation(current+1);else if(e.key==='p')assignFormation(current-1);else if(e.key==='/'){e.preventDefault();$('search').focus();}});
$('presetCount').textContent=`${PRESETS.length} FORMATIONS`;renderFilters();renderLibrary();resize();assignFormation(0,true);requestAnimationFrame(draw);
