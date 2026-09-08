"""Generated-history and accompaniment ablations for the new guitarist."""
import argparse,json
from pathlib import Path
import numpy as np,torch
from .trancefusion import load,make_song,encode,peer_features,evaluate,generate,statistics
from .data import write_midi
from .audio import render

def continuity(roll):
    motifs=[]
    for bar in (1,2,3,4,5,6):
        section=roll[bar*16:(bar+1)*16];root=np.flatnonzero(section[0,1]>0)
        if not len(root):continue
        indices=np.argwhere(section[:,2]>=2)
        if len(indices)>=3:motifs.append(tuple((indices[:3,1]-int(root.min()))%12))
    return float(np.mean([np.mean(np.array(m)==motifs[0]) for m in motifs[1:]])) if len(motifs)>1 else 0.

def run(path,out,split='val',count=8):
    torch.set_num_threads(4);device='cuda' if torch.cuda.is_available() else 'cpu';model,ck=load(path,device)
    indices=ck['splits'][split];indices=indices[32:] if split=='val' else indices
    songs=[make_song(i+40000)[0] for i in indices];ys=torch.tensor(np.stack([encode(x) for x in songs]),device=device);xs=torch.tensor(np.stack([peer_features(x) for x in songs]),device=device)
    result={'checkpoint':str(path),'split':split,'teacher_forced':{'listening':evaluate(model,ys,xs),'no_peers':evaluate(model,ys,torch.zeros_like(xs))},'generated':[]}
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    for j,(idx,backing) in enumerate(zip(indices[:count],songs[:count])):
        for no in (False,True):
            generated=generate(model,backing,2701+j,no_peers=no);stats=statistics(generated);stats['motif_continuity']=continuity(generated)
            result['generated'].append({'song':idx,'listening':not no,'statistics':stats})
            if j<3:
                name=f'{split}-{j}'+('-no-peers' if no else '')
                write_midi(generated,out/f'{name}.mid',118,['bass','keys','trancefusion guitarist','drums']);render(out/f'{name}.mid',out/f'{name}.wav')
    (out/'probe.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('checkpoint');p.add_argument('--out',required=True);p.add_argument('--split',choices=['val','test'],default='val');p.add_argument('--count',type=int,default=8);a=p.parse_args();run(a.checkpoint,a.out,a.split,a.count)
