"""Pitch correctness on delayed replies, with known or free target history."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from .audio import render
from .data import write_midi
from .generate import perform
from .train import load_checkpoint, choose_device, inputs


def probe(checkpoint, data_path, output, device='auto'):
    device = choose_device(device)
    model, ckpt = load_checkpoint(checkpoint, device)
    model.eval()
    data = np.load(data_path, allow_pickle=False)
    if not str(data['source']).startswith('synthetic call-and-response'):
        raise ValueError('This probe is specific to the conversation corpus')
    idx = [i for i, g in enumerate(data['groups']) if g in ckpt['val_groups']][:32]
    result = {'teacher_forced': {}}
    with torch.inference_mode():
        for role, offset, label in [(0,1,'bass'), (2,4,'lead')]:
            acc = {'listening':[], 'no_peers':[], 'shuffled_peers':[]}
            for start in range(0,len(idx),4):
                selected=idx[start:start+4]
                band=torch.tensor(data['rolls'][selected].astype(np.int64),device=device)
                ids=torch.tensor(data['identities'][selected],device=device)
                roles=torch.full((len(selected),),role,device=device)
                peers,prev,y=inputs(band,ids,roles)
                positions=torch.arange(offset,band.shape[1],8,device=device)
                target=(y[:,positions]>=2).long().argmax(-1)
                for name,p in [('listening',peers),('no_peers',torch.zeros_like(peers)),('shuffled_peers',peers.roll(1,0))]:
                    logits=model(p,prev,ids,roles)
                    predicted=logits.softmax(-1)[...,2:].sum(-1)[:,positions].argmax(-1)
                    acc[name].extend((predicted==target).flatten().tolist())
            result['teacher_forced'][label]={k:float(np.mean(v)) for k,v in acc.items()}
    # Three held-out keyboard performances, supplied unchanged as the cue.
    result['anchored_generation']=[]
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    for j, i in enumerate(idx[:3]):
        prompt=np.zeros_like(data['rolls'][i]);prompt[:,1]=data['rolls'][i,:,1]
        identity=data['identities'][i].tolist()
        for listening in (True,False):
            generated=perform(model,identity,len(prompt),2,.85,17+j,listening,prompt,(1,))
            stats={}
            for role,offset,label in [(0,1,'bass'),(2,4,'lead')]:
                positions=np.arange(offset,len(prompt),8)
                target=(data['rolls'][i,positions,role]>=2).argmax(-1)
                onsets=generated[positions,role]>=2
                stats[label]={'correct_reply_fraction':float(onsets[np.arange(len(positions)),target].mean()),
                              'reply_coverage':float(onsets.any(-1).mean())}
            result['anchored_generation'].append({'song':str(data['groups'][i]),'listening':listening,**stats})
            if j==0:
                path=output/('anchored.mid' if listening else 'anchored-independent.mid')
                write_midi(generated,path,names=[ckpt['registry'][k]['name'] for k in identity]);render(path,path.with_suffix('.wav'))
    (output/'response-probe.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('checkpoint');p.add_argument('data');p.add_argument('--out',required=True);p.add_argument('--device',default='auto')
    a=p.parse_args();probe(a.checkpoint,a.data,a.out,a.device)
