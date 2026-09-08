from dataclasses import asdict, dataclass

import torch
from torch import nn

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

    def forward(self, peers, previous, ids, role):
        b, t = previous.shape[:2]
        if t > self.config.steps:
            raise ValueError("Sequence exceeds the checkpoint's context length")
        x = torch.cat((self.state(peers).reshape(b, t, -1),
                       self.state(previous).reshape(b, t, -1)), dim=-1)
        x = self.input(x) + self.position(torch.arange(t, device=x.device))[None]
        x = x + self.band(self.identity(ids).flatten(1))[:, None] + self.role(role)[:, None]
        causal = torch.ones(t, t, device=x.device, dtype=torch.bool).triu(1)
        return self.output(self.transformer(x, mask=causal)).reshape(b, t, 128, STATES)

    def metadata(self):
        return asdict(self.config)
