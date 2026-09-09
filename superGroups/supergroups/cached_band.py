"""Incremental inference for the existing causal BandModel (unchanged weights)."""
import torch
from torch.nn import functional as F

class CachedBand:
    def __init__(self,model,ids,role):
        if model.training:raise ValueError('Cached inference requires eval mode')
        self.m=model;self.ids=ids;self.role=role;self.kv=[None]*len(model.transformer.layers)
        self.identity=model.identity(ids[torch.arange(len(ids),device=ids.device),role])
        self.condition=model.band(model.identity(ids).flatten(1))+model.role(role)
    @torch.inference_mode()
    def step(self,peers,previous,t):
        m=self.m;b=len(previous)
        z=torch.cat((m.state(peers[:,-1:]).reshape(b,1,-1),m.state(previous[:,None]).reshape(b,1,-1)),-1)
        x=m.input(z)+m.position(torch.tensor([t],device=previous.device))[None]+self.condition[:,None]
        for i,layer in enumerate(m.transformer.layers):
            q,k,v=F.linear(layer.norm1(x),layer.self_attn.in_proj_weight,layer.self_attn.in_proj_bias).chunk(3,-1)
            heads=layer.self_attn.num_heads;dim=q.shape[-1]//heads
            q,k,v=[a.reshape(b,1,heads,dim).transpose(1,2) for a in (q,k,v)]
            if self.kv[i] is not None:
                pk,pv=self.kv[i];k=torch.cat((pk,k),2);v=torch.cat((pv,v),2)
            self.kv[i]=(k,v)
            attention=F.scaled_dot_product_attention(q,k,v,dropout_p=0).transpose(1,2).reshape(b,1,-1)
            x=x+layer.self_attn.out_proj(attention)
            x=x+layer.linear2(layer.activation(layer.linear1(layer.norm2(x))))
        if m.transformer.norm is not None:x=m.transformer.norm(x)
        logits=m.output(x).reshape(b,128,10)
        identity=self.identity[:,None].expand(-1,128,-1)
        if m.config.local_transition:logits=logits+m.transition(torch.cat((m.state(previous),identity),-1))
        if m.config.pitch_context:
            history=peers[:,-8:];a=(history>0).permute(0,2,1,3).float();o=(history>=2).permute(0,2,1,3).float()
            heard=F.gelu(m.pitch_listener(torch.cat((a,o),1)))
            heard=F.gelu(m.time_listener(F.pad(heard,(0,0,max(0,8-heard.shape[2]),0)))).squeeze(2).permute(0,2,1)
            logits=logits+m.response(torch.cat((heard,identity),-1))
        return logits
