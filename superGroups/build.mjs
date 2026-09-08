import {mkdir,copyFile,cp,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const catalog=JSON.parse(await readFile('assets/catalog.json'));
assert.equal(Object.keys(catalog).length,81);
const stages=JSON.parse(await readFile('assets/stages.json'));assert.equal(stages.length,5);
for(const t of [...Object.values(catalog),...stages,JSON.parse(await readFile('assets/response.json'))]){
 assert.equal(t.tracks.length,4);assert(t.bpm>0);assert.equal(t.lineup.length,4);
 t.tracks.forEach((notes,r)=>notes.forEach(([s,d,p,v])=>{assert(s>=0&&d>0&&s+d<=t.steps);assert(p>=0&&p<128&&v>0&&v<=127)}));
}
await mkdir('dist',{recursive:true});for(const f of ['index.html','style.css','app.js','audio.js'])await copyFile(f,`dist/${f}`);await cp('assets','dist/assets',{recursive:true});
console.log('Built listening room: five stages, response test, 81 ensembles. All note bounds validated.');
