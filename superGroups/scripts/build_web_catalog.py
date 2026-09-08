import argparse,itertools,json,time
from pathlib import Path
import numpy as np,torch,mido
from supergroups.train import load_checkpoint
from supergroups.data import read_track,write_midi
parser=argparse.ArgumentParser()
parser.add_argument('--results',type=Path,required=True,help='Extracted t4-iterations directory')
parser.add_argument('--baseline',type=Path,required=True,help='Original supergroup.mid')
parser.add_argument('--out',type=Path,default=Path('assets'))
args=parser.parse_args()
ROOT=args.out; ROOT.mkdir(exist_ok=True,parents=True)
def events(roll):
    result=[]
    for r in range(4):
        notes=[]
        for p in range(128):
            start=None
            for t in range(len(roll)+1):
                v=int(roll[t,r,p]) if t<len(roll) else 0
                if start is not None and v!=1:
                    notes.append([start,t-start,p,vel]);start=None
                if v>=2:start=t;vel=min(127,(v-2)*16+8)
        result.append(sorted(notes))
    return result
stages=[]
paths=[args.baseline]+[args.results/r/'eval/listening-17.mid' for r in ['run1-duration','run2-conversation','run3-pitch-listener','run4-pitch-objective']]
for i,p in enumerate(paths):
    mid=mido.MidiFile(p); stages.append({'id':str(i),'tracks':[read_track(mid,r+1) for r in range(4)],'steps':128,'bpm':110,'lineup':[0,5,7,9]})
    (ROOT/f'stage-{i}.mid').write_bytes(p.read_bytes())
(ROOT/'stages.json').write_text(json.dumps(stages))
p=args.results/'final-unseen-probe/anchored.mid';mid=mido.MidiFile(p)
(ROOT/'response.json').write_text(json.dumps({'tracks':[read_track(mid,r+1) for r in range(4)],'steps':128,'bpm':110,'lineup':[1,4,6,10]}));(ROOT/'response.mid').write_bytes(p.read_bytes())
torch.set_num_threads(4)
model,_=load_checkpoint(args.results/'run4-pitch-objective/best.pt','cpu');model.eval()
combos=list(itertools.product(range(3),repeat=4)); catalog={}
@torch.inference_mode()
def batch(choices):
    b=len(choices);steps=64
    ids=torch.tensor([[r*3+c[r] for r in range(4)] for c in choices]);band=torch.zeros(b,steps,4,128,dtype=torch.long)
    gen=torch.Generator().manual_seed(1709+len(catalog))
    for rnd in range(2):
        for role in (3,0,1,2):
            peers=band.clone();peers[:,:,role]=0
            prev=torch.zeros(b,steps,128,dtype=torch.long);active=torch.zeros(b,128,dtype=torch.bool)
            roles=torch.full((b,),role)
            lo,hi=((28,60),(36,96),(48,96),(35,82))[role];cap=(1,5,1,3)[role]
            for t in range(steps):
                logits=model(peers[:,:t+1],prev[:,:t+1],ids,roles)[:,-1].clone()
                logits[:,:,0]-=(~active)*np.log(.03);logits/=.85
                logits[:,:,1].masked_fill_(~active,-torch.inf)
                if role==3:logits[:,:,1]=-torch.inf
                logits[:,:lo,1:]=-torch.inf;logits[:,hi:,1:]=-torch.inf
                state=torch.multinomial(logits.softmax(-1).reshape(-1,10),1,generator=gen).reshape(b,128)
                for j in range(b):
                    sounding=torch.where(state[j]>0)[0]
                    if len(sounding)>cap:
                        scores=logits[j].log_softmax(-1);confidence=scores[sounding,state[j,sounding]]-scores[sounding,0]
                        keep=sounding[confidence.topk(cap).indices];state[j,sounding]=0
                        state[j,keep]=torch.multinomial(logits[j,keep,1:].softmax(-1),1,generator=gen).flatten()+1
                band[:,t,role]=state;active=state>0
                if t+1<steps:prev[:,t+1]=state
    return band.numpy().astype(np.uint8)
for n in range(0,81,9):
    choices=combos[n:n+9];out=batch(choices)
    for c,roll in zip(choices,out):
        key=''.join(map(str,c));catalog[key]={'tracks':events(roll),'steps':64,'bpm':110,'lineup':[r*3+c[r] for r in range(4)]}
        write_midi(roll,ROOT/f'band-{key}.mid',110)
    (ROOT/'catalog.json').write_text(json.dumps(catalog,separators=(',',':')))
    print(f'{len(catalog)}/81 ensembles generated',flush=True)
