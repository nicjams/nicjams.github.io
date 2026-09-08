"""Quantized polyphonic MIDI, explicit musician labels, and synthetic practice."""
import json
from pathlib import Path

import mido
import numpy as np

from .model import ROLES

PROGRAMS = (33, 0, 80, 0)


def note(grid, start, length, pitch, velocity=88):
    if start >= len(grid):
        return
    end = min(len(grid), start + max(1, length))
    grid[start:end, pitch] = 1
    grid[start, pitch] = 2 + min(7, max(0, (velocity - 1) // 16))


def write_midi(roll, path, bpm=110, names=ROLES):
    if bpm <= 0:
        raise ValueError("BPM must be positive")
    midi = mido.MidiFile(ticks_per_beat=480)
    tempo = mido.MidiTrack()
    midi.tracks.append(tempo)
    tempo.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm)))
    for role, name in enumerate(names):
        track = mido.MidiTrack()
        midi.tracks.append(track)
        channel = 9 if role == 3 else role
        track.append(mido.MetaMessage("track_name", name=name))
        track.append(mido.Message("program_change", program=PROGRAMS[role], channel=channel))
        active, events = set(), []
        for step in range(len(roll) + 1):
            state = roll[step, role] if step < len(roll) else np.zeros(128)
            for pitch in sorted(active.copy()):
                if state[pitch] != 1 or role == 3:
                    events.append((step * 120, mido.Message("note_off", note=pitch, velocity=0, channel=channel)))
                    active.remove(pitch)
            for pitch in np.flatnonzero(state >= 2):
                events.append((step * 120, mido.Message("note_on", note=int(pitch),
                    velocity=min(127, (int(state[pitch]) - 2) * 16 + 8), channel=channel)))
                active.add(int(pitch))
        last = 0
        for tick, event in events:
            event.time, last = tick - last, tick
            track.append(event)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    midi.save(str(path))


def read_track(midi, index):
    """Read ticks, independent of tempo changes; quantize to sixteenth notes."""
    active, notes, tick = {}, [], 0
    for msg in midi.tracks[index]:
        tick += msg.time
        if msg.type not in ("note_on", "note_off"):
            continue
        key = (msg.channel, msg.note)
        if key in active:
            start, vel = active.pop(key)
            notes.append((start, tick, msg.note, vel))
        if msg.type == "note_on" and msg.velocity:
            active[key] = (tick, msg.velocity)
    for (_, pitch), (start, velocity) in active.items():
        notes.append((start, max(tick, start + midi.ticks_per_beat / 4), pitch, velocity))
    return [(round(start * 4 / midi.ticks_per_beat),
             max(1, round(end * 4 / midi.ticks_per_beat) - round(start * 4 / midi.ticks_per_beat)),
             pitch, vel) for start, end, pitch, vel in notes]


def save_dataset(path, rolls, identities, groups, registry, source):
    if len(rolls) < 2 or len(set(groups)) < 2:
        raise ValueError("Need at least two separate songs for train/validation separation")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, rolls=np.asarray(rolls, dtype=np.uint8),
        identities=np.asarray(identities, dtype=np.int64), groups=np.asarray(groups),
        registry=json.dumps(registry), source=source)


def demo(path, songs=128, steps=128, seed=7):
    if steps < 16 or songs < 2:
        raise ValueError("Demo requires at least 2 songs and 16 steps")
    rng = np.random.default_rng(seed)
    styles = ("pocket", "restless", "spacious")
    registry = [{"name": f"{style}-{role}", "role": role, "style": style}
                for role in ROLES for style in styles]
    rolls, ids = [], []
    for _ in range(songs):
        choices = rng.integers(0, 3, 4)
        roll = np.zeros((steps, 4, 128), np.uint8)
        tonic = int(rng.integers(0, 12))
        for bar in range((steps + 15) // 16):
            start = bar * 16
            root = tonic + (0, 5, 7, 0)[bar % 4]
            # Each player responds to a shared harmonic and rhythmic context.
            for role in range(3):
                style = choices[role]
                positions = ((0, 6, 8, 14), tuple(range(0, 16, 2)), (0, 10))[style]
                if role == 2:
                    positions = tuple(p + 1 for p in positions if p < 15)
                for pos in positions:
                    base = (36, 48, 60)[role] + root
                    pitches = [base] if role == 0 else ([base, base + 4, base + 7] if role == 1 else [base + int(rng.choice([0, 4, 7, 12]))])
                    for pitch in pitches:
                        note(roll[:, role], start + pos, (2, 1, 5)[style], pitch, int(rng.integers(64, 112)))
            for pos in range(0, 16, (2, 1, 4)[choices[3]]):
                note(roll[:, 3], start + pos, 1, 42, int(rng.integers(40, 85)))
            for pos in (0, 8):
                note(roll[:, 3], start + pos, 1, 36, 110)
            for pos in (4, 12):
                note(roll[:, 3], start + pos, 1, 38, 96)
            if choices[3] == 1:
                note(roll[:, 3], start + 14, 1, 38, 75)
        rolls.append(roll)
        ids.append([role * 3 + int(choices[role]) for role in range(4)])
    save_dataset(path, rolls, ids, [f"synthetic-{i}" for i in range(songs)], registry, "synthetic practice patterns; not artist performances")


def prepare(manifest_path, output, steps=128):
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    registry = manifest["musicians"]
    names = {m["name"]: i for i, m in enumerate(registry)}
    if len(names) != len(registry) or any(m["role"] not in ROLES for m in registry):
        raise ValueError("Musicians need unique names and valid roles")
    rolls, identities, groups = [], [], []
    for song in manifest["songs"]:
        midi = mido.MidiFile(manifest_path.parent / song["path"])
        if midi.type == 2 or midi.ticks_per_beat <= 0:
            raise ValueError("Use synchronous MIDI type 0/1 with beat-based timing")
        parts, ids = [], []
        for role in ROLES:
            spec = song["tracks"][role]
            identity = names[spec["musician"]]
            if registry[identity]["role"] != role:
                raise ValueError(f"Musician role mismatch: {role}")
            parts.append(read_track(midi, spec["index"]))
            ids.append(identity)
        if len({song["tracks"][r]["index"] for r in ROLES}) != 4:
            raise ValueError("Assign four separate MIDI tracks, one per role")
        length = max((start + duration for part in parts for start, duration, _, _ in part), default=0)
        if length < steps:
            raise ValueError(f"{song['path']} is shorter than {steps} steps; use a smaller window")
        roll = np.zeros((length, 4, 128), np.uint8)
        for role, part in enumerate(parts):
            for start, duration, pitch, velocity in part:
                note(roll[:, role], start, duration, pitch, velocity)
        # Full windows only; never train on artificial trailing silence.
        for start in range(0, len(roll) - steps + 1, steps):
            window = roll[start:start + steps].copy()
            # Turn boundary-crossing sustains into onsets for standalone windows.
            window[0][window[0] == 1] = 7
            rolls.append(window)
            identities.append(ids)
            groups.append(song["song_id"])
    save_dataset(output, rolls, identities, groups, registry, "user-labelled MIDI manifest")


def conversation(path, songs=256, steps=128, seed=7):
    """Controlled response task, not a corpus of human improvisation.

    Keyboard cues choose a fresh root every half bar. Bass answers after one
    step, lead after four; accented cues elicit a later snare response. Thus
    the target's own past cannot predict each new pitch without its bandmates.
    """
    if songs < 2 or steps < 16 or steps % 8:
        raise ValueError("Use at least two songs and a multiple of eight steps >= 16")
    rng = np.random.default_rng(seed)
    styles = ("pocket", "restless", "spacious")
    registry = [{"name": f"{style}-{role}", "role": role, "style": style}
                for role in ROLES for style in styles]
    rolls, identities = [], []
    for _ in range(songs):
        choice = rng.integers(0, 3, 4)
        roll = np.zeros((steps, 4, 128), np.uint8)
        for at in range(0, steps, 8):
            root = int(rng.integers(0, 12))
            accent = bool(rng.integers(0, 2))
            # Exogenous cue: there is intentionally no way to predict keys'
            # new root from past history. Report responder losses separately.
            for interval in (0, 4, 7):
                note(roll[:, 1], at, (2, 1, 5)[choice[1]], 48 + root + interval, 112 if accent else 64)
            note(roll[:, 0], at+1, (3, 1, 5)[choice[0]], 36+root, 88)
            if choice[0] == 1:
                note(roll[:, 0], at+3, 1, 36+root+7, 72)
            lead_interval = (4, 7, 0)[choice[2]]
            note(roll[:, 2], at+4, (2, 1, 4)[choice[2]], 60+root+lead_interval, 88)
            if choice[2] == 1:
                note(roll[:, 2], at+6, 1, 60+root+4, 72)
            for pos in range(0, 8, (2, 1, 4)[choice[3]]):
                note(roll[:, 3], at+pos, 1, 42, 56)
            note(roll[:, 3], at+1, 1, 36, 96)
            if accent:
                note(roll[:, 3], at+3, 1, 38, 96)
        rolls.append(roll)
        identities.append([r*3+int(choice[r]) for r in range(4)])
    save_dataset(path, rolls, identities, [f"conversation-{i}" for i in range(songs)],
                 registry, "synthetic call-and-response v1; random keyboard cues with delayed replies")
