"""Procedural top-down photos of sand-cast pump impellers, with optional injected defects.

Used to seed the demo when the Kaggle casting dataset is not available, and in tests where
we need ground-truth defect locations.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class SynthDefect:
    type: str
    center: tuple[int, int]
    size_px: float


@dataclass
class SynthCasting:
    image: np.ndarray  # BGR
    center: tuple[int, int]
    radius: int
    defects: list[SynthDefect] = field(default_factory=list)


def _noise(rng: np.random.Generator, h: int, w: int, scale: int) -> np.ndarray:
    small = rng.normal(0, 1, (max(2, h // scale), max(2, w // scale))).astype(np.float32)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)


def render(seed: int, size: int = 640, defects: list[str] | None = None) -> SynthCasting:
    rng = np.random.default_rng(seed)
    h = w = size
    cx = int(w / 2 + rng.integers(-12, 13))
    cy = int(h / 2 + rng.integers(-12, 13))
    R = int(size * rng.uniform(0.40, 0.43))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = xx - cx, yy - cy
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.arctan2(dy, dx)

    # background: dark conveyor / inspection table with soft vignette
    bg = 38 + 10 * _noise(rng, h, w, 40) + 3 * rng.normal(0, 1, (h, w))
    bg -= 18 * (r / (size * 0.7)) ** 2

    # height map of the casting (used for shading)
    height = np.zeros((h, w), np.float32)
    disk = r <= R
    height[disk] = 1.0
    rim = (r > R * 0.88) & disk
    height[rim] += 0.35
    n_vanes = int(rng.choice([6, 7, 8]))
    twist = rng.uniform(0.9, 1.3)
    phase = rng.uniform(0, 2 * math.pi)
    vane_angle = theta - twist * (r / R) - phase
    vane = 0.5 + 0.5 * np.cos(n_vanes * vane_angle)
    vane = np.clip((vane - 0.78) / 0.22, 0, 1) ** 0.6
    vane_zone = (r > R * 0.3) & (r < R * 0.88)
    height[vane_zone] += 0.45 * vane[vane_zone]
    hub = r < R * 0.28
    height[hub] += 0.55 - 0.3 * (r[hub] / (R * 0.28)) ** 2
    bore = r < R * 0.1
    height[bore] = -0.4
    height = cv2.GaussianBlur(height, (0, 0), 2.2)

    # lambert shading from upper-left light
    gy, gx = np.gradient(height * 60)
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1)
    light = np.array([-0.45, -0.55, 0.7])
    light /= np.linalg.norm(light)
    shade = (-gx * light[0] - gy * light[1] + light[2]) * nz

    # sand-cast grain texture
    grain = 6 * rng.normal(0, 1, (h, w)) + 9 * _noise(rng, h, w, 6) + 6 * _noise(rng, h, w, 30)
    metal = 128 + 42 * (shade - 0.6) + grain + 12 * height
    metal -= 22 * (r / R) ** 3  # darker near the edge
    img = np.where(r <= R + 0.5, metal, bg)
    img[bore] = 22 + 6 * rng.normal(0, 1, bore.sum())
    edge = np.clip((R + 1.5 - r) / 3.0, 0, 1)
    img = img * edge + bg * (1 - edge)

    out = SynthCasting(image=np.zeros((h, w, 3), np.uint8), center=(cx, cy), radius=R)
    for kind in defects or []:
        _inject(img, rng, kind, cx, cy, R, out)

    img = cv2.GaussianBlur(np.clip(img, 0, 255).astype(np.float32), (0, 0), 0.7)
    tint = np.array([1.0, 1.01, 1.04])  # slightly cool steel tone (BGR)
    color = np.clip(img[..., None] * tint[None, None, :], 0, 255).astype(np.uint8)
    out.image = color
    return out


def _inject(img: np.ndarray, rng: np.random.Generator, kind: str, cx: int, cy: int, R: int, out: SynthCasting) -> None:
    h, w = img.shape
    if kind == "porosity":
        rad = R * rng.uniform(0.32, 0.8)
        ang = rng.uniform(0, 2 * math.pi)
        px, py = cx + rad * math.cos(ang), cy + rad * math.sin(ang)
        n = int(rng.integers(4, 11))
        spread = rng.uniform(6, 16)
        for _ in range(n):
            qx = int(px + rng.normal(0, spread))
            qy = int(py + rng.normal(0, spread))
            pr = max(1.6, rng.gamma(2.2, 1.5))
            cv2.circle(img, (qx, qy), int(round(pr + 1.5)), float(img[qy, qx] + 22), -1, cv2.LINE_AA)
            cv2.circle(img, (qx, qy), int(round(pr)), float(rng.uniform(18, 40)), -1, cv2.LINE_AA)
        out.defects.append(SynthDefect("porosity", (int(px), int(py)), spread * 2.5))
    elif kind == "crack":
        rad = R * rng.uniform(0.35, 0.75)
        ang = rng.uniform(0, 2 * math.pi)
        x, y = cx + rad * math.cos(ang), cy + rad * math.sin(ang)
        heading = ang + rng.uniform(-0.6, 0.6)  # roughly radial
        pts = [(x, y)]
        length = R * rng.uniform(0.18, 0.32)
        step = 3.0
        for _ in range(int(length / step)):
            heading += rng.normal(0, 0.25)
            x += step * math.cos(heading)
            y += step * math.sin(heading)
            pts.append((x, y))
        arr = np.array(pts, np.int32)
        cv2.polylines(img, [arr], False, 62, 3, cv2.LINE_AA)
        cv2.polylines(img, [arr], False, 18, 2, cv2.LINE_AA)
        mid = arr[len(arr) // 2]
        out.defects.append(SynthDefect("crack", (int(mid[0]), int(mid[1])), length))
    elif kind == "burr":
        ang = rng.uniform(0, 2 * math.pi)
        span = rng.uniform(0.12, 0.25)
        pts = []
        for t in np.linspace(-span / 2, span / 2, 14):
            rr = R + rng.uniform(3, 11) * (1 - (2 * t / span) ** 2)
            pts.append((cx + rr * math.cos(ang + t), cy + rr * math.sin(ang + t)))
        for t in np.linspace(span / 2, -span / 2, 6):
            pts.append((cx + (R - 4) * math.cos(ang + t), cy + (R - 4) * math.sin(ang + t)))
        cv2.fillPoly(img, [np.array(pts, np.int32)], float(rng.uniform(150, 175)), cv2.LINE_AA)
        bx, by = cx + (R + 5) * math.cos(ang), cy + (R + 5) * math.sin(ang)
        out.defects.append(SynthDefect("burr", (int(bx), int(by)), R * span))
    elif kind == "scratch":
        rad = R * rng.uniform(0.3, 0.7)
        ang = rng.uniform(0, 2 * math.pi)
        x0, y0 = cx + rad * math.cos(ang), cy + rad * math.sin(ang)
        d = rng.uniform(0, math.pi)
        L = R * rng.uniform(0.15, 0.3)
        x1, y1 = x0 + L * math.cos(d), y0 + L * math.sin(d)
        cv2.line(img, (int(x0), int(y0)), (int(x1), int(y1)), 205, 2, cv2.LINE_AA)
        out.defects.append(SynthDefect("scratch", (int((x0 + x1) / 2), int((y0 + y1) / 2)), L))
