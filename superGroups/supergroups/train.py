import json
import random
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F

from .model import BandModel, Config, CLASS_WEIGHTS


def choose_device(name):
    if name != "auto":
        return torch.device(name)
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def split_groups(groups, seed=7):
    unique = sorted(set(groups.tolist()))
    if len(unique) < 2:
        raise ValueError("At least two song IDs are required")
    rng = random.Random(seed)
    rng.shuffle(unique)
    held = set(unique[:max(1, len(unique) // 5)])
    val = np.array([i for i, g in enumerate(groups) if g in held])
    train = np.array([i for i, g in enumerate(groups) if g not in held])
    return train, val


def inputs(rolls, ids, roles, dropout=0.0):
    b, t = rolls.shape[:2]
    target = rolls[torch.arange(b, device=rolls.device), :, roles]
    peers = rolls.clone()
    peers[torch.arange(b, device=rolls.device), :, roles] = 0
    if dropout:
        # Practice partial ensembles, including the first player entering silence.
        keep = torch.rand(b, 1, 4, 1, device=rolls.device) > dropout
        peers = peers * keep
    previous = torch.zeros_like(target)
    previous[:, 1:] = target[:, :-1]
    return peers, previous, target


def load_checkpoint(path, device):
    ckpt = torch.load(path, map_location=device, weights_only=True)
    if ckpt.get("format") != 1:
        raise ValueError("Unsupported checkpoint format")
    model = BandModel(Config(**ckpt["config"])).to(device)
    model.load_state_dict(ckpt["model"])
    return model, ckpt


def prediction_loss(logits, target, previous, conditional=False):
    weights = torch.tensor(CLASS_WEIGHTS, device=logits.device)
    if not conditional:
        return F.cross_entropy(logits.flatten(0, 2), target.flatten(), weight=weights)
    # Balance silence only for inactive pitches; active-note transitions retain
    # natural duration statistics and need no class-prior correction at sampling.
    sample_weight = torch.where((previous == 0) & (target == 0), .03, 1.)
    loss = F.cross_entropy(logits.flatten(0, 2), target.flatten(), reduction="none").reshape_as(target)
    return (loss * sample_weight).sum() / sample_weight.sum()


def train(args):
    if min(args.updates, args.batch_size, args.accumulate, args.eval_every) < 1:
        raise ValueError("Training counts must be positive")
    if any(not 0 <= getattr(args, name, default) <= 1 for name, default in
           (("peer_dropout", .4), ("history_dropout", 0.))):
        raise ValueError("Dropout probabilities must lie between zero and one")
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    device = choose_device(args.device)
    with np.load(args.data, allow_pickle=False) as data:
        rolls = torch.from_numpy(data["rolls"].astype(np.int64))
        ids = torch.from_numpy(data["identities"].copy())
        registry = json.loads(str(data["registry"]))
        source = str(data["source"])
        groups = data["groups"].copy()
    tr, va = split_groups(groups, args.seed)
    seen = set(ids[tr].flatten().tolist())
    if not set(ids[va].flatten().tolist()) <= seen:
        raise ValueError("Validation has a musician absent from training. Add more songs per musician or change split seed.")
    config = Config(len(registry), args.width, args.layers, args.heads, rolls.shape[1])
    config.local_transition = getattr(args, "local_transition", False)
    config.conditional_weights = getattr(args, "conditional_weights", False)
    checkpoint = None
    if args.resume:
        model, checkpoint = load_checkpoint(args.resume, device)
        if checkpoint["registry"] != registry or model.config.steps != rolls.shape[1]:
            raise ValueError("Resume requires the same musician registry and sequence length")
        if checkpoint["train_groups"] != sorted(set(groups[tr].tolist())) or checkpoint["val_groups"] != sorted(set(groups[va].tolist())):
            raise ValueError("Resume requires the same song split and seed")
    else:
        model = BandModel(config).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    amp = device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=amp)
    start, best = 0, float("inf")
    if checkpoint:
        optimizer.load_state_dict(checkpoint["optimizer"])
        scaler.load_state_dict(checkpoint["scaler"])
        start, best = checkpoint["update"], checkpoint["best_val"]
        torch.set_rng_state(checkpoint["torch_rng"].cpu())
        rng.bit_generator.state = json.loads(checkpoint["numpy_rng"])
        if amp and checkpoint["cuda_rng"]:
            torch.cuda.set_rng_state_all([x.cpu() for x in checkpoint["cuda_rng"]])
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # Sparse piano rolls otherwise learn near-universal silence. Keep onsets
    # competitive without copying a majority-class accuracy metric.
    print(json.dumps({"device": str(device), "parameters": sum(p.numel() for p in model.parameters()),
        "train_windows": len(tr), "validation_windows": len(va), "source": source}), flush=True)

    def evaluate():
        model.eval()
        losses, onset_tp, onset_fp, onset_fn = [], 0, 0, 0
        # Fixed held-out windows and all roles keep validation comparable over time.
        with torch.no_grad():
            for offset in range(0, min(len(va), 32), args.batch_size):
                idx = va[offset:min(offset + args.batch_size, 32)]
                roll, identity = rolls[idx].to(device), ids[idx].to(device)
                for role in range(4):
                    roles = torch.full((len(idx),), role, device=device)
                    peer, prev, y = inputs(roll, identity, roles)
                    with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=amp):
                        logits = model(peer, prev, identity, roles)
                        loss = prediction_loss(logits, y, prev, model.config.conditional_weights)
                    losses.append(loss.item())
                    probabilities = logits.softmax(-1)
                    predicted = probabilities[..., 2:].sum(-1) > 0.5
                    actual = y >= 2
                    onset_tp += int((predicted & actual).sum())
                    onset_fp += int((predicted & ~actual).sum())
                    onset_fn += int((~predicted & actual).sum())
        model.train()
        return float(np.mean(losses)), 2 * onset_tp / max(1, 2 * onset_tp + onset_fp + onset_fn)

    model.train()
    for update in range(start + 1, start + args.updates + 1):
        optimizer.zero_grad(set_to_none=True)
        running = 0.
        for _ in range(args.accumulate):
            idx = rng.choice(tr, args.batch_size, replace=True)
            roll, identity = rolls[idx].to(device), ids[idx].to(device)
            roles = torch.randint(4, (len(idx),), device=device)
            peer, prev, y = inputs(roll, identity, roles, dropout=getattr(args, "peer_dropout", .4))
            history_dropout = getattr(args, "history_dropout", 0.)
            if history_dropout:
                # Drop whole historical steps (not target labels) to reduce
                # dependence on perfect teacher-forced history.
                prev = prev * (torch.rand(len(idx), prev.shape[1], 1, device=device) > history_dropout)
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=amp):
                logits = model(peer, prev, identity, roles)
                loss = prediction_loss(logits, y, prev, model.config.conditional_weights)
            if not torch.isfinite(loss):
                raise FloatingPointError("Non-finite loss; lower learning rate or disable mixed precision")
            scaler.scale(loss / args.accumulate).backward()
            running += loss.item() / args.accumulate
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.)
        scaler.step(optimizer)
        scaler.update()
        if update % args.eval_every == 0 or update == start + args.updates:
            val, f1 = evaluate()
            improved = val < best
            best = min(best, val)
            row = {"update": update, "train_loss": running, "val_loss": val, "onset_f1": f1}
            print(json.dumps(row), flush=True)
            with (out / "metrics.jsonl").open("a") as stream:
                stream.write(json.dumps(row) + "\n")
            payload = {"format": 1, "config": model.metadata(), "registry": registry,
                "source": source, "model": model.state_dict(), "optimizer": optimizer.state_dict(),
                "scaler": scaler.state_dict(), "update": update, "best_val": best,
                "training_options": {"peer_dropout": getattr(args, "peer_dropout", .4),
                    "history_dropout": getattr(args, "history_dropout", 0.), "seed": args.seed},
                "train_groups": sorted(set(groups[tr].tolist())), "val_groups": sorted(set(groups[va].tolist())),
                "trained_ids": sorted(seen), "torch_rng": torch.get_rng_state(),
                "cuda_rng": torch.cuda.get_rng_state_all() if amp else [],
                "numpy_rng": json.dumps(rng.bit_generator.state)}
            # A terminated Colab runtime must not leave a half-written checkpoint.
            for filename in (["last.pt", "best.pt"] if improved else ["last.pt"]):
                temporary = out / (filename + ".tmp")
                torch.save(payload, temporary)
                temporary.replace(out / filename)
