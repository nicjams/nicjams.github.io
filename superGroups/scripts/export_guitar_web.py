"""Export trained guitar performances for all 27 rhythm sections.
The final guitarist reacts to fixed, looped recordings from the original band
model. It does not imply those frozen tracks learned to follow the guitarist.
"""
import argparse,itertools,json
from pathlib import Path
import numpy as np,torch,mido
from supergroups.trancefusion import load,generate
from supergroups.data import note,read_track,write_midi
p=argparse.ArgumentParser();p.add_argument('--checkpoint',required=True);p.add_argument('--assets',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(exist_ok=True,parents=True)
torch.set_num_threads(4);m,_=load(a.checkpoint,'cuda' if torch.cuda.is_available() else 'cpu');catalog=json.loads((a.assets/'catalog.json').read_text());extra={}
for bass,keys,drums in itertools.product(range(3),repeat=3):
    old=catalog[f'{bass}{keys}0{drums}'];backing=np.zeros((256,4,128),np.uint8)
    for r in (0,1,3):
        for s,d,pitch,v in old['tracks'][r]:
            for offset in range(0,256,64):note(backing[:,r],s+offset,d,pitch,v)
    roll=generate(m,backing,seed=3100+len(extra));key=f'{bass}{keys}3{drums}';path=a.out/f'band-{key}.mid'
    write_midi(roll,path,110,['bass','keys','trancefusion guitarist','drums']);mid=mido.MidiFile(path)
    extra[key]={'tracks':[read_track(mid,r+1) for r in range(4)],'steps':256,'bpm':110,'lineup':[bass,3+keys,12,9+drums],'guitar':True,'backing':'Fixed looped rhythm-section recording; learned guitar response'}
    print(key,flush=True)
(a.out/'guitar-catalog.json').write_text(json.dumps(extra,separators=(',',':')))
