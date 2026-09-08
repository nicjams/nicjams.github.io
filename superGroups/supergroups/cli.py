import argparse
import json

from .audio import render
from .data import demo, prepare, conversation
from .generate import generate
from .train import load_checkpoint, train


def main():
    parser = argparse.ArgumentParser(description="superGroups: train virtual musicians and assemble bands")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("demo-data", help="Create synthetic practice data, not real artist styles")
    p.add_argument("--out", default="data/demo.npz")
    p.add_argument("--songs", type=int, default=128)
    p.add_argument("--steps", type=int, default=128)
    p.add_argument("--seed", type=int, default=7)
    p = sub.add_parser("conversation-data", help="Synthetic random cues and delayed responses")
    p.add_argument("--out", default="data/conversation.npz")
    p.add_argument("--songs", type=int, default=256)
    p.add_argument("--steps", type=int, default=128)
    p.add_argument("--seed", type=int, default=7)
    p = sub.add_parser("prepare", help="Import four labelled MIDI tracks per song")
    p.add_argument("manifest")
    p.add_argument("--out", default="data/custom.npz")
    p.add_argument("--steps", type=int, default=128)
    p = sub.add_parser("train")
    p.add_argument("--data", default="data/demo.npz")
    p.add_argument("--out", default="runs/demo")
    p.add_argument("--updates", type=int, default=1000, help="Additional optimizer updates, including after resume")
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--accumulate", type=int, default=4)
    p.add_argument("--width", type=int, default=192)
    p.add_argument("--layers", type=int, default=4)
    p.add_argument("--heads", type=int, default=6)
    p.add_argument("--lr", type=float, default=0.0003)
    p.add_argument("--eval-every", type=int, default=100)
    p.add_argument("--resume")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--device", default="auto")
    p.add_argument("--local-transition", action="store_true")
    p.add_argument("--pitch-context", action="store_true")
    p.add_argument("--conditional-weights", action="store_true")
    p.add_argument("--peer-dropout", type=float, default=.4)
    p.add_argument("--history-dropout", type=float, default=0.)
    p = sub.add_parser("generate")
    p.add_argument("--checkpoint", default="runs/demo/best.pt")
    p.add_argument("--lineup", default="pocket-bass,spacious-keys,restless-lead,pocket-drums")
    p.add_argument("--out", default="runs/demo/supergroup.mid")
    p.add_argument("--steps", type=int)
    p.add_argument("--rounds", type=int, default=2)
    p.add_argument("--temperature", type=float, default=0.85)
    p.add_argument("--bpm", type=float, default=110)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--device", default="auto")
    p.add_argument("--no-listening", action="store_true", help="Ablation: players hear only themselves")
    p = sub.add_parser("inspect")
    p.add_argument("checkpoint")
    p = sub.add_parser("render", help="Audition MIDI with a simple preview synthesizer")
    p.add_argument("midi")
    p.add_argument("--out", default="runs/preview.wav")
    args = parser.parse_args()
    if args.command == "demo-data":
        demo(args.out, args.songs, args.steps, args.seed)
    elif args.command == "conversation-data":
        conversation(args.out, args.songs, args.steps, args.seed)
    elif args.command == "prepare":
        if args.steps < 1:
            parser.error("steps must be positive")
        prepare(args.manifest, args.out, args.steps)
    elif args.command == "train":
        train(args)
    elif args.command == "generate":
        generate(args)
    elif args.command == "render":
        render(args.midi, args.out)
    else:
        model, checkpoint = load_checkpoint(args.checkpoint, "cpu")
        print(json.dumps({"config": model.metadata(), "musicians": checkpoint["registry"],
                          "source": checkpoint["source"], "update": checkpoint["update"]}, indent=2))


if __name__ == "__main__":
    main()
