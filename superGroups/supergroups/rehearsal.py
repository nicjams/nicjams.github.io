"""Keep a musical lead-in in model context, but omit it from the audible take."""
import numpy as np

def trim_warmup(roll, steps):
    if not isinstance(steps,int) or steps<0 or steps>=len(roll):
        raise ValueError('Warm-up must leave at least one playable step')
    take=np.asarray(roll).copy()[steps:]
    # MIDI needs an onset at the cut for notes held across the boundary.
    # Recover the original velocity rather than inventing a new accent.
    for role,pitch in np.argwhere(take[0]==1):
        velocity=7
        for state in roll[:steps,role,pitch][::-1]:
            if state>=2:velocity=int(state);break
            if state==0:break
        take[0,role,pitch]=velocity
    return take
