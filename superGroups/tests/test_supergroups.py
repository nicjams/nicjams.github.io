import json
from pathlib import Path
import tempfile
import unittest
import wave

import mido
import numpy as np
import torch

from supergroups.data import demo, conversation, note, prepare, read_track, write_midi
from supergroups.audio import render
from supergroups.generate import perform
from supergroups.model import BandModel, Config
from supergroups.train import inputs, split_groups, prediction_loss


class SuperGroupsTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(7)
        torch.set_num_threads(2)

    def test_causal_and_no_target_leak(self):
        model = BandModel(Config(width=32, heads=4, layers=1, steps=16, dropout=0)).eval()
        roll = torch.randint(10, (2, 16, 4, 128))
        ids = torch.tensor([[0, 3, 6, 9]] * 2)
        role = torch.tensor([0, 2])
        peers, prev, y = inputs(roll, ids, role)
        self.assertEqual(int(peers[torch.arange(2), :, role].sum()), 0)
        self.assertTrue(torch.equal(prev[:, 1:], y[:, :-1]))
        first = model(peers, prev, ids, role)
        peers[:, 8:] = 0
        prev[:, 8:] = 0
        second = model(peers, prev, ids, role)
        torch.testing.assert_close(first[:, :8], second[:, :8])
        changed = model(torch.zeros_like(peers), prev, ids, role)
        self.assertFalse(torch.allclose(second[:, :8], changed[:, :8]))
        changed_ids = model(peers, prev, ids + 1, role)
        self.assertFalse(torch.allclose(second, changed_ids))

    def test_midi_roundtrip_polyphony_retrigger_drums(self):
        with tempfile.TemporaryDirectory() as directory:
            roll = np.zeros((16, 4, 128), np.uint8)
            note(roll[:, 0], 0, 4, 40, 88)
            note(roll[:, 0], 4, 4, 40, 88)
            for pitch in (60, 64, 67):
                note(roll[:, 1], 0, 8, pitch, 88)
            note(roll[:, 3], 2, 1, 38, 104)
            path = Path(directory) / "test.mid"
            write_midi(roll, path)
            midi = mido.MidiFile(path)
            rebuilt = np.zeros_like(roll)
            for role in range(4):
                for start, duration, pitch, velocity in read_track(midi, role + 1):
                    note(rebuilt[:, role], start, duration, pitch, velocity)
            np.testing.assert_array_equal(roll, rebuilt)
            self.assertTrue(all(m.channel == 9 for m in midi.tracks[4] if m.type == "note_on"))
            render(path, Path(directory) / "preview.wav")
            with wave.open(str(Path(directory) / "preview.wav")) as audio:
                self.assertEqual(audio.getnchannels(), 2)
                samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2')
                self.assertGreater(np.abs(samples).max(), 0)

    def test_dataset_split_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            demo(path / "demo.npz", songs=16, steps=32)
            with np.load(path / "demo.npz", allow_pickle=False) as data:
                tr, va = split_groups(data["groups"])
                self.assertFalse(set(data["groups"][tr]) & set(data["groups"][va]))
                registry = json.loads(str(data["registry"]))
                songs = []
                for i in range(2):
                    write_midi(data["rolls"][i], path / f"{i}.mid")
                    songs.append({"path": f"{i}.mid", "song_id": f"song-{i}", "tracks": {
                        role: {"index": r + 1, "musician": registry[data["identities"][i, r]]["name"]}
                        for r, role in enumerate(("bass", "keys", "lead", "drums"))}})
            (path / "manifest.json").write_text(json.dumps({"musicians": registry, "songs": songs}))
            prepare(path / "manifest.json", path / "custom.npz", steps=16)
            with np.load(path / "custom.npz", allow_pickle=False) as data:
                tr, va = split_groups(data["groups"])
                self.assertFalse(set(data["groups"][tr]) & set(data["groups"][va]))
                self.assertEqual(data["rolls"].shape, (4, 16, 4, 128))

    def test_generation_reproducible_and_valid(self):
        model = BandModel(Config(width=32, layers=1, heads=4, steps=8))
        a = perform(model, [0, 3, 6, 9], 8, rounds=1)
        b = perform(model, [0, 3, 6, 9], 8, rounds=1)
        np.testing.assert_array_equal(a, b)
        self.assertEqual(a.shape, (8, 4, 128))
        self.assertFalse((a[0] == 1).any())
        self.assertFalse((a[:, 3] == 1).any())
        for role, cap in enumerate((1, 5, 1, 3)):
            self.assertTrue(((a[:, role] > 0).sum(axis=-1) <= cap).all())
        for t in range(1, 8):
            self.assertFalse(((a[t] == 1) & (a[t - 1] == 0)).any())

    def test_local_transition_and_conditional_objective(self):
        model = BandModel(Config(width=32, layers=1, heads=4, steps=8,
                                 local_transition=True, conditional_weights=True))
        roll = torch.randint(10, (2, 8, 4, 128))
        ids = torch.tensor([[0, 3, 6, 9]] * 2)
        role = torch.tensor([0, 2])
        peer, prev, y = inputs(roll, ids, role)
        loss = prediction_loss(model(peer, prev, ids, role), y, prev, True)
        loss.backward()
        self.assertTrue(torch.isfinite(loss))
        self.assertGreater(float(model.transition[0].weight.grad.abs().sum()), 0)
        generated = perform(model, [0, 3, 6, 9], 8, rounds=1)
        self.assertFalse((generated[0] == 1).any())
        for t in range(1, 8):
            self.assertFalse(((generated[t] == 1) & (generated[t-1] == 0)).any())

    def test_conversation_has_delayed_harmonic_responses(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'conversation.npz'
            conversation(path, songs=4, steps=32)
            with np.load(path) as data:
                for roll in data['rolls']:
                    for at in range(0, 32, 8):
                        cue = np.flatnonzero(roll[at, 1] >= 2)
                        bass = np.flatnonzero(roll[at+1, 0] >= 2)
                        self.assertEqual(int(cue.min())-12, int(bass[0]))
                        self.assertFalse((roll[at,0] >= 2).any())

    def test_fixed_keyboard_prompt_is_preserved(self):
        model = BandModel(Config(width=32, heads=4, layers=1, steps=8))
        prompt = np.zeros((8,4,128),dtype=np.uint8)
        note(prompt[:,1],0,4,60)
        saved = prompt.copy()
        generated = perform(model,[0,3,6,9],8,rounds=1,initial_band=prompt,fixed_roles=(1,))
        np.testing.assert_array_equal(generated[:,1],prompt[:,1])
        np.testing.assert_array_equal(prompt,saved)


if __name__ == "__main__":
    unittest.main()
