"""Small deterministic synthesizer for auditioning MIDI, not modelled timbre."""
from pathlib import Path
import wave

import mido
import numpy as np


def render(midi_path, out, sample_rate=22050):
    midi = mido.MidiFile(midi_path)
    notes, active, seconds = [], {}, 0.
    programs = {}
    for msg in midi:
        seconds += msg.time
        if msg.type == "program_change":
            programs[msg.channel] = msg.program
        if msg.type not in ("note_on", "note_off"):
            continue
        key = (msg.channel, msg.note)
        if key in active:
            start, velocity, program = active.pop(key)
            notes.append((start, seconds, msg.channel, msg.note, velocity, program))
        if msg.type == "note_on" and msg.velocity:
            active[key] = (seconds, msg.velocity, programs.get(msg.channel, 0))
    for (channel, pitch), (start, velocity, program) in active.items():
        notes.append((start, max(seconds, start + .1), channel, pitch, velocity, program))
    audio = np.zeros((int((seconds + 1) * sample_rate), 2), np.float32)
    rng = np.random.default_rng(0)
    for start, end, channel, pitch, velocity, program in notes:
        duration = max(.03, end - start)
        t = np.arange(int((duration + .12) * sample_rate)) / sample_rate
        frequency = 440 * 2 ** ((pitch - 69) / 12)
        envelope = np.minimum(t / .008, 1) * np.minimum(np.maximum(duration + .12 - t, 0) / .12, 1)
        if channel == 9:
            if pitch in (35, 36):
                sound = np.sin(2 * np.pi * (55 * t + 4 * (1 - np.exp(-25 * t)))) * np.exp(-18 * t)
            else:
                decay = 40 if pitch in (42, 44, 46) else 22
                sound = rng.standard_normal(len(t)) * np.exp(-decay * t) * .35
        else:
            harmonics = (.7, .2, .1) if program in (32, 33) else (.65, .25, .1)
            sound = sum(weight * np.sin(2 * np.pi * frequency * (h + 1) * t)
                        for h, weight in enumerate(harmonics))
            sound *= envelope * np.exp(-t * (.7 if program == 0 else .2))
        offset = round(start * sample_rate)
        count = min(len(sound), len(audio) - offset)
        pan = {0: .4, 1: .25, 2: .75, 9: .5}.get(channel, .5)
        audio[offset:offset + count] += (sound[:count] * velocity / 127 * .25)[:, None] * np.array([1 - pan, pan])
    peak = np.max(np.abs(audio))
    if peak > .95:
        audio *= .95 / peak
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        stream.writeframes((audio * 32767).astype("<i2").tobytes())
