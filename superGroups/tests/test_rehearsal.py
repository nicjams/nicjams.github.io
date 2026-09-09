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
if __name__=='__main__':unittest.main()
