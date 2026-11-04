"""Defect library: engineer-confirmed and engineer-rejected detections that sharpen future verdicts."""
from __future__ import annotations

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Defect, Inspection


def _distance(a: dict, b: dict) -> float:
    fa, fb = a["features"], b["features"]
    d = 0.0
    d += 0.0 if a["zone"] == b["zone"] else 1.0
    d += abs(math.log((a["max_dim_mm"] + 0.5) / (b["max_dim_mm"] + 0.5)))
    d += abs(fa.get("contrast", 0) - fb.get("contrast", 0)) / 40
    d += abs(math.log((fa.get("elongation", 1) + 1) / (fb.get("elongation", 1) + 1)))
    return d


def exemplars(db: Session, part_id: str, limit: int = 400) -> list[dict]:
    rows = db.execute(
        select(Defect).join(Inspection)
        .where(Inspection.part_id == part_id, Defect.status.in_(("confirmed", "rejected")))
        .order_by(Defect.reviewed_at.desc()).limit(limit)
    ).scalars().all()
    return [{
        "id": r.id, "type": r.type, "status": r.status, "zone": r.zone, "max_dim_mm": r.max_dim_mm,
        "features": r.features or {}, "feedback": r.feedback, "crop": r.crop_path,
    } for r in rows]


def match(defect: dict, library: list[dict], k: int = 5, radius: float = 1.1) -> dict:
    """Nearest reviewed examples of the same type; returns counts and the closest few."""
    same = [e for e in library if e["type"] == defect["type"]]
    scored = sorted(((_distance(defect, e), e) for e in same), key=lambda t: t[0])
    near = [(d, e) for d, e in scored[:k] if d <= radius]
    confirmed = [e for _, e in near if e["status"] == "confirmed"]
    rejected = [e for _, e in near if e["status"] == "rejected"]
    return {
        "confirmed": len(confirmed),
        "rejected": len(rejected),
        "notes": [e["feedback"] for e in rejected if e["feedback"]][:2],
        "nearest": [{"id": e["id"], "status": e["status"], "distance": round(d, 2), "crop": e["crop"]} for d, e in near[:3]],
    }
