import unittest
import numpy as np
from supergroups.rehearsal import trim_warmup
class RehearsalTests(unittest.TestCase):
 def test_trims_every_track_at_identical_time(self):
  x=np.zeros((128,4,128),np.uint8);x[64,:,60]=8;x[70,:,62]=9
  y=trim_warmup(x,64);self.assertEqual(y.shape,(64,4,128));np.testing.assert_equal(y,x[64:])
 def test_carries_notes_and_velocity_across_cut(self):
  x=np.zeros((128,4,128),np.uint8);x[60,2,70]=4;x[61:67,2,70]=1
  y=trim_warmup(x,64);self.assertEqual(y[0,2,70],4);self.assertEqual(y[1,2,70],1);self.assertEqual(x[64,2,70],1)
 def test_rejects_empty_take(self):
  with self.assertRaises(ValueError):trim_warmup(np.zeros((16,4,128),np.uint8),16)

class CacheTests(unittest.TestCase):
 def test_cached_logits_match_full_causal_model(self):
  import torch
  from supergroups.model import BandModel,Config
  from supergroups.cached_band import CachedBand
  torch.manual_seed(81);model=BandModel(Config(width=24,layers=2,heads=4,steps=16,local_transition=True,conditional_weights=True,pitch_context=True)).eval()
  peers=torch.randint(0,10,(2,12,4,128));previous=torch.randint(0,10,(2,12,128));ids=torch.tensor([[0,4,7,9],[1,5,8,11]]);roles=torch.tensor([2,0]);peers[torch.arange(2),:,roles]=0
  cache=CachedBand(model,ids,roles)
  with torch.no_grad():
   for t in range(12):torch.testing.assert_close(cache.step(peers[:,:t+1],previous[:,t],t),model(peers[:,:t+1],previous[:,:t+1],ids,roles)[:,-1],rtol=1e-4,atol=1e-5)

if __name__=='__main__':unittest.main()
