"""Description-derived synthetic guitarist: causal event prediction over 16 bars.
No artist recordings or transcriptions are used. Accompaniment is an input,
not a future target: each step sees only the backing heard through that step.
"""
import argparse,json,time,hashlib
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from .data import note,write_midi
from .audio import render

NAME='trancefusion guitarist'
STEPS=256

def make_song(seed):
    rng=np.random.default_rng(seed);roll=np.zeros((STEPS,4,128),np.uint8)
    tonic=int(rng.integers(12));minor=bool(rng.integers(2));third=3 if minor else 4
    # Independently sampled motifs: shape, rhythm and progression travel together
    # within a song and are split as a whole before any training.
    rhythm=np.array([(0,3,6,10),(0,2,6,12),(0,4,7,10),(0,3,8,12)][int(rng.integers(4))])
    motif=np.array([0,int(rng.choice([third,7])),int(rng.choice([7,9,12])),int(rng.choice([third,7]))])
    progression=rng.choice([[0,0,5,7],[0,5,0,7],[0,0,3,5],[0,7,5,0]]).tolist()
    types=rng.integers(0,3,4);types[2]=3
    root_schedule=[]
    for bar in range(16):
        phase=bar//4;root=tonic+progression[(bar//2)%4];root_schedule.append(root)
        dark=minor if phase<2 else not minor
        intervals=[0,3 if dark else 4,7]
        # Backing maintains pulse; density and duration reflect musician styles.
        for pos in range(0,16,(8,4,8)[types[0]]):
            note(roll[:,0],bar*16+pos,(3,1,6)[types[0]],36+root,90)
        for pos in range(0,16,(8,4,8)[types[1]]):
            for interval in intervals:note(roll[:,1],bar*16+pos,(3,1,7)[types[1]],48+root+interval,70+phase*8)
        for pos in range(0,16,(2,1,4)[types[3]]):note(roll[:,3],bar*16+pos,1,42,50+(pos%4==0)*15)
        for pos in (0,4,8,12):note(roll[:,3],bar*16+pos,1,36,100)
        for pos in (4,12):note(roll[:,3],bar*16+pos,1,38,95)
        # Establish -> repeat -> transform -> climb/resolve, including full gaps.
        if bar in (0,7,11):continue
        positions=rhythm.copy();pitches=motif.copy()
        pitches[pitches==third]=intervals[1]
        if bar%4==3:pitches[-1]=0  # phrase ending remembers the tonic
        if phase>=2:pitches[-1]=int(rng.choice([7,9,12])) if bar%2 else pitches[-1]
        octave=12 if bar in (12,13,14) else 0
        for j,(pos,interval) in enumerate(zip(positions,pitches)):
            length=1 if phase in (1,2) else (2 if j<3 else 4)
            if bar==15 and j==3:length=16-int(pos);interval=0
            pitch=min(91,60+root+int(interval)+octave)
            note(roll[:,2],bar*16+int(pos),length,pitch,62+phase*14+(j==0)*12)
        if bar in (6,10,14):
            for pos,interval in zip((13,14,15),(2,intervals[1],7)):
                # Clear the monophonic lead before a connecting run.
                roll[bar*16+pos,2]=0
                note(roll[:,2],bar*16+pos,1,min(91,60+root+interval+octave),90+phase*8)
    return roll,types.tolist(),{'seed':seed,'tonic':tonic,'minor':minor,'rhythm':rhythm.tolist(),'motif':motif.tolist(),'roots':root_schedule}

def encode(roll):
    lead=roll[:,2];action=np.where((lead>=2).any(-1),2,np.where((lead>0).any(-1),1,0))
    pitch=np.where(action>0,lead.argmax(-1)-48,48).clip(0,48)
    velocity=np.maximum(0,lead.max(-1).astype(int)-2)
    return np.stack((action,pitch,velocity),-1).astype(np.int64)

def peer_features(roll):
    a=(roll>0).astype(np.float32);o=(roll>=2).astype(np.float32)
    # Explicitly exclude the guitarist from every accompaniment feature.
    chunks=[]
    for role in (0,1):
        chunks.extend([np.stack([a[:,role,p::12].sum(-1) for p in range(12)],-1).clip(0,1),
                       np.stack([o[:,role,p::12].sum(-1) for p in range(12)],-1).clip(0,1)])
    chunks.append(np.stack([o[:,3,[35,36]].sum(-1),o[:,3,[38,40]].sum(-1),o[:,3,[42,44,46]].sum(-1)],-1).clip(0,1))
    return np.concatenate(chunks,-1).astype(np.float32)

class Guitarist(nn.Module):
    def __init__(self,memory=False,width=128,layers=3):
        super().__init__();self.config={'memory':memory,'width':width,'layers':layers}
        self.action=nn.Embedding(3,12);self.pitch=nn.Embedding(49,36);self.velocity=nn.Embedding(8,8)
        self.input=nn.Linear(56,width);self.peers=nn.Linear(51,width);self.position=nn.Embedding(STEPS,width)
        block=nn.TransformerEncoderLayer(width,4,width*3,.1,batch_first=True,norm_first=True)
        self.transformer=nn.TransformerEncoder(block,layers,enable_nested_tensor=False)
        for layer in self.transformer.layers:
            for p in layer.parameters():
                if p.ndim>1:nn.init.xavier_uniform_(p)
        if memory:self.motif=nn.Linear(56,width,bias=False)
        self.norm=nn.LayerNorm(width);self.head=nn.Linear(width,3+48+8)
    def embed(self,x):return torch.cat((self.action(x[...,0]),self.pitch(x[...,1]),self.velocity(x[...,2])),-1)
    def forward(self,previous,peers):
        b,t,_=previous.shape;x=self.input(self.embed(previous))+self.peers(peers)+self.position(torch.arange(t,device=previous.device))[None]
        if self.config['memory']:
            # previous[t-15] is target[t-16], exactly one bar ago. Causal.
            memory=torch.zeros_like(previous);memory[...,1]=48
            if t>15:memory[:,15:]=previous[:,:-15]
            x=x+self.motif(self.embed(memory))
        x=self.norm(self.transformer(x,mask=torch.ones(t,t,device=x.device,dtype=torch.bool).triu(1)))
        y=self.head(x);return y[...,:3],y[...,3:51],y[...,51:]

def shift(y):
    prev=torch.zeros_like(y);prev[...,1]=48;prev[:,1:]=y[:,:-1];return prev

def loss(pred,y):
    a,p,v=pred;on=y[...,0]==2
    return F.cross_entropy(a.flatten(0,1),y[...,0].flatten())+F.cross_entropy(p[on],y[...,1][on])+.1*F.cross_entropy(v[on],y[...,2][on])

def load(path,device='cpu'):
    ck=torch.load(path,map_location=device,weights_only=True);m=Guitarist(**ck['config']).to(device);m.load_state_dict(ck['model']);m.eval();return m,ck

@torch.inference_mode()
def generate(model,backing,seed=1709,temperature=.8,no_peers=False):
    dev=next(model.parameters()).device;features=torch.tensor(peer_features(backing),device=dev)[None]
    if no_peers:features.zero_()
    prev=torch.zeros(1,len(backing),3,dtype=torch.long,device=dev);prev[...,1]=48
    rng=torch.Generator(device=dev).manual_seed(seed);out=backing.copy();out[:,2]=0;active=None
    for t in range(len(backing)):
        a,p,v=model(prev[:,:t+1],features[:,:t+1]);a=a[0,-1].clone()
        if active is None:a[1]=-torch.inf
        act=int(torch.multinomial((a/temperature).softmax(-1),1,generator=rng))
        pitch=48;vel=0
        if act==2:
            pitch=int(torch.multinomial((p[0,-1]/temperature).softmax(-1),1,generator=rng));vel=int(torch.multinomial(v[0,-1].softmax(-1),1,generator=rng));active=pitch+48;out[t,2,active]=vel+2
        elif act==1:pitch=active-48;out[t,2,active]=1
        else:active=None
        if t+1<len(backing):prev[0,t+1]=torch.tensor([act,pitch,vel],device=dev)
    return out

def statistics(roll):
    y=encode(roll);a=y[:,0];bars=[]
    for b in range(16):bars.append(set(np.where(a[b*16:(b+1)*16]==2)[0].tolist()))
    onset_count=int((a==2).sum());silent_bars=sum(not x for x in bars)
    repeats=[len(bars[i]&bars[i-1])/max(1,len(bars[i]|bars[i-1])) for i in range(1,16) if bars[i] and bars[i-1]]
    pitches=[y[b*16:(b+1)*16,1][a[b*16:(b+1)*16]==2]+48 for b in range(16)]
    early=np.concatenate(pitches[1:4]);late=np.concatenate(pitches[12:15]);on=np.flatnonzero(a==2)
    durations=[]
    for t in on:
        end=t+1
        while end<len(a) and a[end]==1:end+=1
        durations.append(end-t)
    return {'notes':onset_count,'silent_bars':silent_bars,'rhythm_recurrence':float(np.mean(repeats)) if repeats else 0.,'register_lift':float(late.mean()-early.mean()) if len(early) and len(late) else None,'mean_duration':float(np.mean(durations)) if durations else 0.,'sustained_fraction':float(np.mean(np.array(durations)>=3)) if durations else 0.}

@torch.inference_mode()
def evaluate(model,ys,xs,batch=8):
    model.eval();ls=[];ac=[];pc=[]
    for i in range(0,len(ys),batch):
        y,x=ys[i:i+batch],xs[i:i+batch];pred=model(shift(y),x);ls.append(float(loss(pred,y)));ac.append(float((pred[0].argmax(-1)==y[...,0]).float().mean()));on=y[...,0]==2;pc.append(float((pred[1].argmax(-1)[on]==y[...,1][on]).float().mean()))
    return {'loss':float(np.mean(ls)),'action_accuracy':float(np.mean(ac)),'onset_pitch_accuracy':float(np.mean(pc))}

def train(args):
    torch.manual_seed(19);np.random.seed(19);torch.set_num_threads(4)
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True);device=torch.device(args.device)
    model=Guitarist(args.memory).to(device)
    if args.init:
        old,ck=load(args.init,device);model.load_state_dict(old.state_dict(),strict=False)
        if args.memory and not old.config['memory']:nn.init.zeros_(model.motif.weight)
    songs=[make_song(i+40000) for i in range(640)]
    order=np.random.default_rng(19).permutation(640);tr,va,te=order[:512],order[512:576],order[576:]
    ys=torch.tensor(np.stack([encode(s[0]) for s in songs]),device=device);xs=torch.tensor(np.stack([peer_features(s[0]) for s in songs]),device=device)
    opt=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=.01);amp=device.type=='cuda';scaler=torch.amp.GradScaler('cuda',enabled=amp)
    report={'name':NAME,'source':'Original synthetic exercises derived from user musical description; no artist recordings','device':str(device),'gpu':torch.cuda.get_device_name(0) if amp else None,'parameters':sum(p.numel() for p in model.parameters()),'config':model.config,'options':vars(args),'train_songs':512,'validation_songs':64,'test_songs':64,'steps':256,'seed':19}
    (out/'provenance.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
    initial=evaluate(model,ys[va[:32]],xs[va[:32]]);print('INITIAL',json.dumps(initial),flush=True)
    best=float('inf');start=time.time();rng=np.random.default_rng(19)
    for update in range(1,args.updates+1):
        model.train();idx=rng.choice(tr,args.batch,replace=True);y=ys[idx];x=xs[idx].clone();prev=shift(y)
        if args.corruption:
            corrupt=torch.rand(*prev.shape[:2],device=device)<args.corruption
            prev[corrupt]=torch.tensor([0,48,0],device=device)
        drop=torch.rand(len(y),1,1,device=device)<.1;x=x*(~drop)
        opt.zero_grad(set_to_none=True)
        with torch.autocast(device.type,dtype=torch.float16,enabled=amp):l=loss(model(prev,x),y)
        if not torch.isfinite(l):raise FloatingPointError('Nonfinite loss')
        scaler.scale(l).backward();scaler.unscale_(opt);torch.nn.utils.clip_grad_norm_(model.parameters(),1.);scaler.step(opt);scaler.update()
        if update%250==0 or update==args.updates:
            val=evaluate(model,ys[va[:32]],xs[va[:32]]);row={'update':update,'train_loss':float(l),'validation':val,'elapsed_seconds':time.time()-start};print(json.dumps(row),flush=True)
            with (out/'metrics.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
            if val['loss']<best:
                best=val['loss'];payload={'format':'trancefusion-v1','config':model.config,'model':model.state_dict(),'optimizer':opt.state_dict(),'scaler':scaler.state_dict(),'update':update,'provenance':report,'splits':{'train':tr.tolist(),'val':va.tolist(),'test':te.tolist()}}
                torch.save(payload,out/'best.tmp');(out/'best.tmp').replace(out/'best.pt')
    model,ck=load(out/'best.pt',device);final={'initial':initial,'validation':evaluate(model,ys[va[32:]],xs[va[32:]]),'samples':[]}
    # Test set reserved for final selected experiment; do not adapt on it.
    for j,idx in enumerate(va[32:35]):
        backing=songs[idx][0];result=generate(model,backing,1709+j);write_midi(result,out/f'sample-{j}.mid',118,['pocket-bass','spacious-keys',NAME,'pocket-drums']);render(out/f'sample-{j}.mid',out/f'sample-{j}.wav');final['samples'].append({'song':int(idx),'reference':statistics(backing),'generated':statistics(result)})
    (out/'evaluation.json').write_text(json.dumps(final,indent=2));print('COMPLETE',json.dumps(final),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--device',default='cuda');p.add_argument('--updates',type=int,default=1500);p.add_argument('--batch',type=int,default=8);p.add_argument('--lr',type=float,default=.0003);p.add_argument('--memory',action='store_true');p.add_argument('--init');p.add_argument('--corruption',type=float,default=0.);train(p.parse_args())
