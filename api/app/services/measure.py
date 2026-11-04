"""Turn segmentation masks into physical measurements (mm), zones and shape features."""
from __future__ import annotations

import math

import cv2
import numpy as np

from ..providers.base import Detection, PartGeometry

ZONES = [(0.3, "hub"), (0.86, "vane"), (1.0, "rim"), (math.inf, "edge")]
ZONE_LABEL = {"hub": "near the hub", "vane": "in the vane area", "rim": "on the outer rim", "edge": "on the outer edge"}


def zone_of(r_norm: float) -> str:
    for limit, name in ZONES:
        if r_norm < limit:
            return name
    return "edge"


def clock_position(dx: float, dy: float) -> int:
    ang = (math.degrees(math.atan2(dx, -dy)) + 360) % 360  # 0 = 12 o'clock, clockwise
    return int(round(ang / 30)) % 12 or 12


def feret(mask: np.ndarray) -> float:
    pts = cv2.findNonZero(mask)
    if pts is None:
        return 0.0
    hull = cv2.convexHull(pts).reshape(-1, 2).astype(np.float32)
    if len(hull) < 2:
        return 1.0
    d = hull[:, None, :] - hull[None, :, :]
    return float(np.sqrt((d ** 2).sum(-1)).max()) + 1.0


def polygons(mask: np.ndarray, eps: float = 1.2) -> list[list[list[int]]]:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in contours:
        if cv2.contourArea(c) < 4:
            continue
        approx = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        out.append(approx.astype(int).tolist())
    return out


def measure(det: Detection, gray: np.ndarray, part: PartGeometry | None, mm_per_px: float) -> dict:
    mask = det.mask
    ys, xs = np.nonzero(mask)
    cx_d, cy_d = float(xs.mean()), float(ys.mean())
    if part is not None:
        (pcx, pcy), R = part.center, part.radius
    else:
        pcx, pcy, R = gray.shape[1] / 2, gray.shape[0] / 2, min(gray.shape) / 2
    dx, dy = cx_d - pcx, cy_d - pcy
    if det.type == "burr":
        # burrs sit on the silhouette: use the outermost point
        r_px = float(np.hypot(xs - pcx, ys - pcy).max())
    else:
        r_px = float(math.hypot(dx, dy))
    r_norm = r_px / max(R, 1.0)
    zone = zone_of(r_norm)

    max_dim_mm = feret(mask) * mm_per_px
    area_mm2 = float(mask.sum()) * mm_per_px ** 2
    vals = gray[mask > 0].astype(np.float32)
    ring = cv2.dilate(mask, np.ones((9, 9), np.uint8)) - mask
    ring_vals = gray[ring > 0].astype(np.float32)
    contrast = float(abs(np.median(ring_vals) - np.median(vals))) if ring_vals.size else 0.0
    rect = cv2.minAreaRect(cv2.findNonZero(mask))
    elong = max(rect[1]) / max(1.0, min(rect[1]))

    feats = {
        "contrast": round(contrast, 1),
        "elongation": round(float(elong), 2),
        "r_norm": round(r_norm, 3),
        "clock": clock_position(dx, dy),
        "mean_gray": round(float(vals.mean()), 1),
    }
    key_mm = max_dim_mm
    if det.type == "porosity":
        pores = ((gray < 55) & (mask > 0)).astype(np.uint8)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(pores, connectivity=8)
        sizes = [feret((labels == i).astype(np.uint8)) * mm_per_px for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= 2]
        feats["pore_count"] = len(sizes) or 1
        feats["largest_pore_mm"] = round(max(sizes) if sizes else max_dim_mm, 2)
        feats["cluster_span_mm"] = round(max_dim_mm, 2)
        key_mm = feats["largest_pore_mm"]
    elif det.type == "burr":
        feats["protrusion_mm"] = round(max(0.0, (r_px - R)) * mm_per_px, 2)
        feats["length_mm"] = round(max_dim_mm, 2)
        key_mm = feats["protrusion_mm"]
    feats["key_size_mm"] = round(key_mm, 2)

    location = f"{ZONE_LABEL[zone]} at {feats['clock']} o'clock"
    return {
        "type": det.type,
        "prompt": det.prompt,
        "confidence": round(det.score, 3),
        "bbox": det.bbox,
        "polygons": polygons(mask),
        "area_mm2": round(area_mm2, 2),
        "max_dim_mm": round(max_dim_mm, 2),
        "zone": zone,
        "location": location,
        "features": feats,
    }


def scale_for(part: PartGeometry | None, diameter_mm: float, fallback_width_px: int) -> float:
    if part is not None and part.radius > 10:
        return diameter_mm / (2 * part.radius)
    return diameter_mm / max(fallback_width_px * 0.85, 1)
