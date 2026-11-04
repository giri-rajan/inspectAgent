"""Offline segmenter used when no Meta Model API key is configured.

Classical OpenCV stand-ins for SAM 3.1 text prompts: local-contrast blobs for porosity,
thin dark ridges for cracks, thin bright lines for scratches and silhouette protrusions for burrs.
It runs on any photo, so the demo works without network access, but SAM 3.1 is the real path.
"""
from __future__ import annotations

import cv2
import numpy as np

from .base import CANONICAL, Detection, PartGeometry, canonical_type


def find_part(gray: np.ndarray) -> PartGeometry | None:
    """Locate a roughly circular part as the largest bright silhouette."""
    h, w = gray.shape
    blur = cv2.GaussianBlur(gray, (0, 0), 3)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.05 * h * w:
        return None
    mask = np.zeros_like(gray, np.uint8)
    cv2.drawContours(mask, [c], -1, 1, -1)
    return geometry_from_mask(mask, "opencv")


def geometry_from_mask(mask: np.ndarray, method: str) -> PartGeometry:
    m = cv2.moments(mask, binaryImage=True)
    cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    pts = max(contours, key=cv2.contourArea).reshape(-1, 2).astype(np.float32)
    # median edge distance ignores small protrusions such as burrs
    radius = float(np.median(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy)))
    return PartGeometry((float(cx), float(cy)), radius, mask.astype(np.uint8), method)


def _components(binary: np.ndarray, min_area: int):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary.astype(np.uint8), connectivity=8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            yield (labels == i).astype(np.uint8), stats[i]


def _elongation(comp: np.ndarray) -> tuple[float, float, float]:
    """(length, thickness, straightness) of a thin component."""
    pts = cv2.findNonZero(comp)
    (_, _), (rw, rh), _ = cv2.minAreaRect(pts)
    length = max(rw, rh, 1.0)
    area = float(comp.sum())
    thickness = area / length
    straightness = length / max(cv2.arcLength(cv2.convexHull(pts), True) / 2, 1.0)
    return length, thickness, straightness


class MockSegmenter:
    name = "opencv-fallback"

    def segment(self, bgr: np.ndarray, prompts: list[str], part: PartGeometry | None) -> list[Detection]:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        if part is None:
            part = find_part(gray)
        if part is None:
            inner = np.ones_like(gray, np.uint8)
            cx, cy, R = w / 2, h / 2, min(h, w) / 2
        else:
            (cx, cy), R = part.center, part.radius
            inner = cv2.erode(part.mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        yy, xx = np.mgrid[0:h, 0:w]
        rr = np.hypot(xx - cx, yy - cy)
        k = max(15, int(R * 0.08) | 1)
        g = gray.astype(np.int16)
        bg = cv2.medianBlur(gray, k).astype(np.int16)
        dark = bg - g
        bright = g - bg
        # the central bore is a designed hole, not a defect
        bore = ((rr < R * 0.16) & (gray < 70)).astype(np.uint8)
        bore = cv2.dilate(bore, np.ones((7, 7), np.uint8))
        valid = (inner > 0) & (bore == 0)

        out: list[Detection] = []
        for prompt in prompts:
            kind = canonical_type(prompt)
            if kind == "porosity":
                found = self._porosity(gray, dark, valid, R)
            elif kind == "crack":
                found = self._crack(gray, dark, valid, R)
            elif kind == "scratch":
                found = self._scratch(bright, valid, R)
            elif kind == "burr":
                found = self._burr(gray, part, rr, R) if part is not None else []
            else:
                found = self._anomaly(dark, bright, valid, R)
            out += [Detection(prompt=prompt, type=kind, mask=m, score=s) for m, s in found]
        return _dedupe(out)

    def _porosity(self, gray, dark, valid, R):
        ksz = max(9, int(R * 0.05) | 1)
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksz, ksz)))
        pores = ((blackhat > 45) & (gray < 50) & valid).astype(np.uint8)
        keep = np.zeros_like(pores)
        for comp, st in _components(pores, 3):
            area = st[cv2.CC_STAT_AREA]
            bw, bh = st[cv2.CC_STAT_WIDTH], st[cv2.CC_STAT_HEIGHT]
            fill = area / float(bw * bh)
            if area <= (R * 0.06) ** 2 and fill > 0.45 and max(bw, bh) / max(1, min(bw, bh)) < 2.6:
                keep |= comp
        if not keep.any():
            return []
        link = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(R * 0.09) | 1,) * 2))
        res = []
        for cluster, _ in _components(link, 1):
            members = keep & cluster
            n = cv2.connectedComponents(members)[0] - 1
            # a lone speck is usually sand grain texture; real porosity clusters or is deep
            if n < 2 and not (members.sum() >= 12 and gray[members > 0].min() < 35):
                continue
            hull = cv2.convexHull(cv2.findNonZero(members))
            m = np.zeros_like(keep)
            cv2.fillPoly(m, [hull], 1)
            m = cv2.dilate(m, np.ones((5, 5), np.uint8))
            contrast = float(dark[members > 0].mean())
            res.append((m, float(np.clip(0.55 + contrast / 300 + 0.03 * n, 0.4, 0.97))))
        return res

    def _crack(self, gray, dark, valid, R):
        ridge = ((dark > 45) & (gray < 60) & valid).astype(np.uint8)
        ridge = cv2.morphologyEx(ridge, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        res = []
        for comp, _ in _components(ridge, 20):
            length, thick, straight = _elongation(comp)
            if length > R * 0.08 and thick < 4.5 and length / max(thick, 1) > 7:
                contrast = float(dark[comp > 0].mean())
                m = cv2.dilate(comp, np.ones((5, 5), np.uint8))
                res.append((m, float(np.clip(0.5 + contrast / 250 + (1 - straight) * 0.2, 0.4, 0.96))))
        return res

    def _scratch(self, bright, valid, R):
        line = ((bright > 45) & valid).astype(np.uint8)
        line = cv2.morphologyEx(line, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        res = []
        for comp, _ in _components(line, 15):
            length, thick, straight = _elongation(comp)
            if length > R * 0.08 and thick < 5 and straight > 0.85:
                m = cv2.dilate(comp, np.ones((5, 5), np.uint8))
                res.append((m, float(np.clip(0.55 + float(bright[comp > 0].mean()) / 300, 0.4, 0.93))))
        return res

    def _burr(self, gray, part, rr, R):
        _, th = cv2.threshold(cv2.GaussianBlur(gray, (0, 0), 1.5), 0, 1, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        outside = (th > 0) & (rr > R + max(2.5, R * 0.012)) & (rr < R * 1.12)
        outside = cv2.morphologyEx(outside.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        res = []
        for comp, st in _components(outside, max(12, int(R * 0.05))):
            prot = float(rr[comp > 0].max() - R)
            m = cv2.dilate(comp, np.ones((5, 5), np.uint8))
            res.append((m, float(np.clip(0.55 + prot / (R * 0.08), 0.4, 0.95))))
        return res

    def _anomaly(self, dark, bright, valid, R):
        odd = (((dark > 55) | (bright > 60)) & valid).astype(np.uint8)
        odd = cv2.dilate(odd, np.ones((7, 7), np.uint8))
        res = []
        for comp, st in _components(odd, int((R * 0.03) ** 2)):
            res.append((comp, 0.5))
        return res


def _dedupe(dets: list[Detection]) -> list[Detection]:
    """Drop near-duplicate masks of the same type (synonym prompts hit the same region).

    A free-text prompt (no known type) must not re-flag a region a known type already explains.
    """
    kept: list[Detection] = []
    for d in sorted(dets, key=lambda d: (d.type not in CANONICAL, -d.score)):
        dup = False
        for k in kept:
            if k.type != d.type and not (d.type not in CANONICAL and k.type in CANONICAL):
                continue
            inter = float((k.mask & d.mask).sum())
            if inter / max(1.0, min(k.mask.sum(), d.mask.sum())) > 0.5:
                dup = True
                break
        if not dup:
            kept.append(d)
    return kept
