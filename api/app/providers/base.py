from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

CANONICAL = {
    "porosity": ["porosity", "pore", "pinhole", "blowhole", "blow hole", "gas hole", "void", "shrinkage", "hole"],
    "crack": ["crack", "fracture", "fissure", "hot tear", "tear"],
    "burr": ["burr", "flash", "fin", "sharp edge", "rough edge"],
    "scratch": ["scratch", "scuff", "score", "gouge", "mark"],
}


def canonical_type(prompt: str) -> str:
    p = prompt.lower().strip()
    for key, words in CANONICAL.items():
        if any(w in p for w in words):
            return key
    return p.replace(" ", "_")[:32] or "anomaly"


@dataclass
class Detection:
    prompt: str  # the plain-word prompt that produced it
    type: str  # canonical defect type
    mask: np.ndarray  # full-frame uint8 0/1
    score: float
    extra: dict = field(default_factory=dict)

    @property
    def bbox(self) -> list[int]:
        ys, xs = np.nonzero(self.mask)
        return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


@dataclass
class PartGeometry:
    center: tuple[float, float]
    radius: float
    mask: np.ndarray  # uint8 0/1, part silhouette
    method: str
