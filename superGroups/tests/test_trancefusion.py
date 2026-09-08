import unittest
import numpy as np
import torch
from supergroups.trancefusion import Guitarist,make_song,encode,peer_features,shift
class TrancefusionTests(unittest.TestCase):
 def test_causal_memory(self):
  torch.manual_seed(1);m=Guitarist(True,width=32,layers=1).eval();y=torch.zeros(1,40,3,dtype=torch.long);y[...,1]=48;x=torch.randn(1,40,51)
  with torch.no_grad():a=m(y,x);y[:,22:,0]=2;y[:,22:,1]=20;x[:,22:]=0;b=m(y,x)
  for aa,bb in zip(a,b):torch.testing.assert_close(aa[:,:22],bb[:,:22])
 def test_no_lead_in_peer_features(self):
  roll,_,_=make_song(99);x=peer_features(roll);roll[:,2]=0;np.testing.assert_equal(x,peer_features(roll))
 def test_synthetic_monophony_and_phrase_space(self):
  for seed in range(20):
   roll,_,_=make_song(seed);self.assertLessEqual((roll[:,2]>0).sum(-1).max(),1);self.assertEqual(int(roll[:16,2].sum()),0);self.assertTrue((encode(roll)[:,1]<=48).all())
 def test_shift_has_no_current_targets(self):
  y=torch.randint(0,3,(2,32,3));p=shift(y);torch.testing.assert_close(p[:,1:],y[:,:-1]);self.assertTrue((p[:,0,1]==48).all())
if __name__=='__main__':unittest.main()
