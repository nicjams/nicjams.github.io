import json
from pathlib import Path

import numpy as np
import torch

from .data import write_midi
from .model import ROLES, CLASS_WEIGHTS
from .train import choose_device, load_checkpoint


@torch.inference_mode()
def perform(model, identities, steps, rounds=2, temperature=0.85, seed=7, listening=True):
    if steps < 1 or steps > model.config.steps or rounds < 1 or temperature <= 0:
        raise ValueError("Invalid steps, rounds, or temperature")
    model.eval()
    device = next(model.parameters()).device
    generator = torch.Generator(device=device).manual_seed(seed)
    band = torch.zeros((1, steps, 4, 128), dtype=torch.long, device=device)
    ids = torch.tensor([identities], device=device)
    # Each round lets everyone revise their part after hearing the others.
    # The fixed order is deliberate and documented; it introduces order bias.
    for _ in range(rounds):
        for role in (3, 0, 1, 2):
            peers = band.clone() if listening else torch.zeros_like(band)
            peers[:, :, role] = 0
            previous = torch.zeros((1, steps, 128), dtype=torch.long, device=device)
            active = torch.zeros(128, dtype=torch.bool, device=device)
            for t in range(steps):
                logits = model(peers[:, :t + 1], previous[:, :t + 1], ids,
                               torch.tensor([role], device=device))[0, -1]
                # Undo the training class reweighting before sampling, otherwise
                # onset upweighting produces unnaturally dense performances.
                if model.config.conditional_weights:
                    correction = torch.zeros_like(logits)
                    correction[~active, 0] = torch.tensor(.03, device=device).log()
                    logits = (logits - correction) / temperature
                else:
                    logits = (logits - torch.tensor(CLASS_WEIGHTS, device=device).log()) / temperature
                # Sustain cannot start a note. Drums are always one-step hits.
                logits[~active, 1] = -torch.inf
                if role == 3:
                    logits[:, 1] = -torch.inf
                # Instrument ranges are generation constraints, not learned style.
                allowed = torch.zeros(128, dtype=torch.bool, device=device)
                lo, hi = ((28, 60), (36, 96), (48, 96), (35, 82))[role]
                allowed[lo:hi] = True
                logits[~allowed, 1:] = -torch.inf
                state = torch.multinomial(logits.softmax(-1), 1, generator=generator).squeeze(-1)
                # Bound density to avoid chaotic early-checkpoint samples.
                cap = (1, 5, 1, 3)[role]
                sounding = torch.where(state > 0)[0]
                if len(sounding) > cap:
                    confidence = logits.log_softmax(-1)[sounding, state[sounding]] - logits.log_softmax(-1)[sounding, 0]
                    keep = sounding[confidence.topk(cap).indices]
                    state[sounding] = 0
                    state[keep] = torch.multinomial(logits[keep, 1:].softmax(-1), 1, generator=generator).squeeze(-1) + 1
                band[0, t, role] = state
                active = state > 0
                if t + 1 < steps:
                    previous[0, t + 1] = state
    return band[0].cpu().numpy().astype(np.uint8)


def generate(args):
    device = choose_device(args.device)
    model, ckpt = load_checkpoint(args.checkpoint, device)
    names = args.lineup.split(",")
    if len(names) != 4:
        raise ValueError("Lineup must contain bass,keys,lead,drums musician names in that order")
    registry = ckpt["registry"]
    lookup = {m["name"]: i for i, m in enumerate(registry)}
    identities = []
    for name, role in zip(names, ROLES):
        if name not in lookup or registry[lookup[name]]["role"] != role:
            raise ValueError(f"Unknown {role} musician {name!r}; inspect checkpoint registry")
        identities.append(lookup[name])
    if not set(identities) <= set(ckpt["trained_ids"]):
        raise ValueError("Lineup includes an identity absent from the training split")
    result = perform(model, identities, args.steps or model.config.steps, args.rounds,
                     args.temperature, args.seed, not args.no_listening)
    write_midi(result, args.out, args.bpm, names)
    metadata = {"lineup": names, "seed": args.seed, "temperature": args.temperature,
        "rounds": args.rounds, "bpm": args.bpm, "steps": len(result),
        "listening": not args.no_listening, "checkpoint_update": ckpt["update"],
        "training_source": ckpt["source"], "notes_per_role": (result >= 2).sum(axis=(0, 2)).tolist()}
    Path(args.out).with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata), flush=True)
