from dataclasses import asdict, dataclass

import torch
from torch import nn
from torch.nn import functional as F

ROLES = ("bass", "keys", "lead", "drums")
STATES = 10  # silence, sustain, eight onset velocity bins
CLASS_WEIGHTS = (0.03, 0.2) + (1.,) * 8


@dataclass
class Config:
    musicians: int = 12
    width: int = 192
    layers: int = 4
    heads: int = 6
    steps: int = 128
    dropout: float = 0.1
    local_transition: bool = False
    conditional_weights: bool = False
    pitch_context: bool = False


class BandModel(nn.Module):
    """Predict one musician from its past and the ensemble heard so far.

    peers: B,T,4,128 categorical states; target slot MUST be zero.
    previous: B,T,128 target states shifted right by one step.
    ids: B,4 musician registry indices. role: B target role indices.
    """

    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self.state = nn.Embedding(STATES, 4)
        self.input = nn.Linear(5 * 128 * 4, config.width)
        self.identity = nn.Embedding(config.musicians, 32)
        self.band = nn.Linear(4 * 32, config.width)
        self.role = nn.Embedding(4, config.width)
        self.position = nn.Embedding(config.steps, config.width)
        layer = nn.TransformerEncoderLayer(
            config.width, config.heads, config.width * 4,
            dropout=config.dropout, batch_first=True, norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(layer, config.layers, enable_nested_tensor=False)
        # TransformerEncoder clones parameters; initialize layers independently.
        for block in self.transformer.layers:
            for parameter in block.parameters():
                if parameter.ndim > 1:
                    nn.init.xavier_uniform_(parameter)
        self.output = nn.Sequential(nn.LayerNorm(config.width), nn.Linear(config.width, 128 * STATES))
        if config.local_transition:
            # Shared across pitches: learn how an already sounding note behaves
            # without relearning the same transition independently 128 times.
            self.transition = nn.Sequential(nn.Linear(36, 64), nn.GELU(), nn.Linear(64, STATES))
        if config.pitch_context:
            # Shared relative-pitch receptive field: no fixed chord or response
            # rules. The network learns intervals across octaves and a causal
            # eight-step history directly from the other musicians' notes.
            self.pitch_listener = nn.Conv2d(8, 16, (1, 49), padding=(0, 24))
            self.time_listener = nn.Conv2d(16, 16, (8, 1))
            self.response = nn.Sequential(nn.Linear(48, 32), nn.GELU(), nn.Linear(32, STATES))

    def forward(self, peers, previous, ids, role):
        b, t = previous.shape[:2]
        if t > self.config.steps:
            raise ValueError("Sequence exceeds the checkpoint's context length")
        x = torch.cat((self.state(peers).reshape(b, t, -1),
                       self.state(previous).reshape(b, t, -1)), dim=-1)
        x = self.input(x) + self.position(torch.arange(t, device=x.device))[None]
        x = x + self.band(self.identity(ids).flatten(1))[:, None] + self.role(role)[:, None]
        causal = torch.ones(t, t, device=x.device, dtype=torch.bool).triu(1)
        logits = self.output(self.transformer(x, mask=causal)).reshape(b, t, 128, STATES)
        if self.config.local_transition:
            target_id = ids[torch.arange(b, device=ids.device), role]
            identity = self.identity(target_id)[:, None, None].expand(-1, t, 128, -1)
            logits = logits + self.transition(torch.cat((self.state(previous), identity), dim=-1))
        if self.config.pitch_context:
            active = (peers > 0).permute(0, 2, 1, 3).float()
            onsets = (peers >= 2).permute(0, 2, 1, 3).float()
            heard = F.gelu(self.pitch_listener(torch.cat((active, onsets), dim=1)))
            heard = F.gelu(self.time_listener(F.pad(heard, (0, 0, 7, 0))))
            heard = heard.permute(0, 2, 3, 1)
            target_id = ids[torch.arange(b, device=ids.device), role]
            identity = self.identity(target_id)[:, None, None].expand(-1, t, 128, -1)
            logits = logits + self.response(torch.cat((heard, identity), dim=-1))
        return logits

    def metadata(self):
        return asdict(self.config)
