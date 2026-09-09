import {mkdir,copyFile,cp,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const catalog=JSON.parse(await readFile('assets/catalog.json'));
assert.equal(Object.keys(catalog).length,108);
for(const take of Object.values(catalog)){assert.equal(take.warmup_bars,4);assert.equal(take.steps,take.guitar?192:64);assert.equal(take.rehearsal_rounds,take.guitar?1:3);}
for(let b=0;b<3;b++)for(let k=0;k<3;k++)for(let l=0;l<4;l++)for(let d=0;d<3;d++)assert(catalog[`${b}${k}${l}${d}`], 'Missing lineup');
const stages=JSON.parse(await readFile('assets/stages.json'));assert.equal(stages.length,8);
for(const t of [...Object.values(catalog),...stages,JSON.parse(await readFile('assets/response.json'))]){
 assert.equal(t.tracks.length,4);assert(t.bpm>0);assert.equal(t.lineup.length,4);
 t.tracks.forEach((notes,r)=>notes.forEach(([s,d,p,v])=>{assert(s>=0&&d>0&&s+d<=t.steps);assert(p>=0&&p<128&&v>0&&v<=127)}));
}
await mkdir('dist',{recursive:true});for(const f of ['index.html','style.css','app.js','audio.js'])await copyFile(f,`dist/${f}`);await cp('assets','dist/assets',{recursive:true});
console.log('Built listening room: eight stages, response test, 108 ensembles. All note bounds validated.');
