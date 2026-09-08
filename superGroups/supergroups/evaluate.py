"""Controlled listening/identity ablations and free-generation diagnostics."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from .data import read_track, write_midi
from .audio import render
from .generate import perform
from .model import ROLES
from .train import choose_device, inputs, load_checkpoint, prediction_loss


def evaluate(checkpoint, dataset, out, device='auto', seeds=(17, 29, 41), windows=32):
    device = choose_device(device)
    model, ckpt = load_checkpoint(checkpoint, device)
    model.eval()
    data = np.load(dataset, allow_pickle=False)
    held = set(ckpt['val_groups'])
    indices = np.array([i for i, g in enumerate(data['groups']) if g in held])[:windows]
    if not len(indices):
        raise ValueError('Dataset does not contain checkpoint validation groups')
    rolls = torch.from_numpy(data['rolls'].astype(np.int64))
    ids = torch.from_numpy(data['identities'].copy())
    by_role = {}
    with torch.inference_mode():
        for r, role in enumerate(ROLES):
            results = {k: [] for k in ('listening', 'no_peers', 'shuffled_peers', 'wrong_identity')}
            for start in range(0, len(indices), 4):
                idx = indices[start:start+4]
                band, identity = rolls[idx].to(device), ids[idx].to(device)
                roles = torch.full((len(idx),), r, device=device)
                peer, prev, y = inputs(band, identity, roles)
                wrong = identity.clone()
                candidates = [i for i, m in enumerate(ckpt['registry']) if m['role'] == role and i in ckpt['trained_ids']]
                for i in range(len(idx)):
                    wrong[i, r] = candidates[(candidates.index(int(identity[i, r]))+1) % len(candidates)]
                for label, context, person in [('listening', peer, identity),
                    ('no_peers', torch.zeros_like(peer), identity),
                    ('shuffled_peers', peer.roll(1, 0), identity),
                    ('wrong_identity', peer, wrong)]:
                    logits = model(context, prev, person, roles)
                    results[label].append(float(prediction_loss(logits, y, prev, model.config.conditional_weights)))
            by_role[role] = {k: float(np.mean(v)) for k, v in results.items()}
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    # Explicit stable lineup, selecting alternate styles across roles.
    identities = []
    for r, role in enumerate(ROLES):
        choices = [i for i,m in enumerate(ckpt['registry']) if m['role']==role and i in ckpt['trained_ids']]
        identities.append(choices[(0,2,1,0)[r] % len(choices)])
    names = [ckpt['registry'][i]['name'] for i in identities]
    generated = []
    for seed in seeds:
        variants = {}
        for listening in (True,False):
            label = 'listening' if listening else 'independent'
            roll = perform(model, identities, model.config.steps, 2, .85, seed, listening)
            path = out / f'{label}-{seed}.mid'
            write_midi(roll, path, names=names)
            if seed == seeds[0]:
                render(path, path.with_suffix('.wav'))
            import mido
            midi = mido.MidiFile(path)
            stats = []
            for r in range(4):
                notes = read_track(midi, r+1)
                stats.append({'role':ROLES[r], 'notes':len(notes),
                    'mean_duration':float(np.mean([x[1] for x in notes])) if notes else 0.,
                    'one_step_fraction':float(np.mean([x[1]==1 for x in notes])) if notes else 0.})
            variants[label] = roll
            generated.append({'seed':seed, 'condition':label, 'roles':stats})
        generated.append({'seed':seed, 'changed_steps_per_role':(variants['listening'] != variants['independent']).any(-1).sum(0).tolist()})
    report = {'checkpoint_update':ckpt['update'],'config':ckpt['config'],
              'dataset_source':str(data['source']),'validation_windows':len(indices),
              'loss_by_role':by_role,'mean_loss':{k:float(np.mean([v[k] for v in by_role.values()])) for k in results},
              'lineup':names,'generated':generated}
    (out/'evaluation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)
    return report

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('checkpoint');p.add_argument('dataset');p.add_argument('--out',required=True)
    p.add_argument('--device',default='auto');p.add_argument('--seeds',default='17,29,41');p.add_argument('--windows',type=int,default=32)
    a=p.parse_args()
    evaluate(a.checkpoint,a.dataset,a.out,a.device,tuple(map(int,a.seeds.split(','))),a.windows)
