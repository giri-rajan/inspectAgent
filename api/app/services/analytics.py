"""Production-quality analytics. Every function here doubles as a root-cause agent tool."""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import Integer, and_, func, select
from sqlalchemy.orm import Session

from ..db import Defect, Inspection

DIMENSIONS = ("machine", "shift", "supplier", "operator", "batch")
SHIFT_NAMES = {"A": "Shift A (06-14)", "B": "Shift B (14-22)", "C": "Shift C (night, 22-06)"}


def _since(days: int) -> datetime:
    return datetime.now() - timedelta(days=days)


def _base(part_id: str, days: int, until_days: int = 0):
    conds = [Inspection.part_id == part_id, Inspection.created_at >= _since(days)]
    if until_days:
        conds.append(Inspection.created_at < _since(until_days))
    return and_(*conds)


def _hit_ids(defect_type: str | None):
    q = select(Defect.inspection_id)
    if defect_type and defect_type != "any":
        q = q.where(Defect.type == defect_type)
    else:
        q = q.where(Defect.severity != "ignore")
    return q.distinct()


def _z(rate: float, base: float, n: int) -> float:
    if n == 0 or base <= 0 or base >= 1:
        return 0.0
    return (rate - base) / math.sqrt(base * (1 - base) / n)


def rate_by(db: Session, part_id: str, dimension: str, defect_type: str = "porosity", days: int = 42,
            until_days: int = 0) -> dict:
    if dimension not in DIMENSIONS:
        raise ValueError(f"dimension must be one of {DIMENSIONS}")
    col = getattr(Inspection, dimension)
    hit = Inspection.id.in_(_hit_ids(defect_type))
    rows = db.execute(
        select(col, func.count(), func.sum(hit.cast(Integer)))
        .where(_base(part_id, days, until_days), col != "").group_by(col)
    ).all()
    total = sum(r[1] for r in rows)
    hits = sum(r[2] or 0 for r in rows)
    base = hits / total if total else 0.0
    out = []
    for key, n, h in rows:
        h = h or 0
        rate = h / n if n else 0.0
        out.append({"key": key or "-", "inspected": n, "defective": h, "rate": round(rate, 4),
                    "lift": round(rate / base, 2) if base else 0.0, "share": round(h / hits, 3) if hits else 0.0,
                    "z": round(_z(rate, base, n), 1)})
    out.sort(key=lambda r: -r["rate"])
    if dimension == "batch":
        out = out[:10]
    return {"dimension": dimension, "defect_type": defect_type, "days": days, "overall_rate": round(base, 4),
            "inspected": total, "defective": hits, "rows": out}


def rate_by_pair(db: Session, part_id: str, dim_a: str, dim_b: str, defect_type: str = "porosity", days: int = 42) -> dict:
    a, b = getattr(Inspection, dim_a), getattr(Inspection, dim_b)
    hit = Inspection.id.in_(_hit_ids(defect_type))
    rows = db.execute(
        select(a, b, func.count(), func.sum(hit.cast(Integer))).where(_base(part_id, days), a != "", b != "").group_by(a, b)
    ).all()
    total = sum(r[2] for r in rows)
    hits = sum(r[3] or 0 for r in rows)
    base = hits / total if total else 0.0
    cells = []
    for ka, kb, n, h in rows:
        h = h or 0
        rate = h / n if n else 0.0
        cells.append({"a": ka, "b": kb, "inspected": n, "defective": h, "rate": round(rate, 4),
                      "lift": round(rate / base, 2) if base else 0.0, "share": round(h / hits, 3) if hits else 0.0,
                      "z": round(_z(rate, base, n), 1)})
    cells.sort(key=lambda c: -c["rate"])
    return {"dim_a": dim_a, "dim_b": dim_b, "defect_type": defect_type, "overall_rate": round(base, 4), "cells": cells}


def trend(db: Session, part_id: str, defect_type: str = "porosity", days: int = 42, bucket_days: int = 7) -> dict:
    hit = Inspection.id.in_(_hit_ids(defect_type))
    rows = db.execute(
        select(Inspection.created_at, hit).where(_base(part_id, days))
    ).all()
    buckets: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    start = _since(days)
    for ts, h in rows:
        b = int((ts - start).days // bucket_days)
        buckets[b][0] += 1
        buckets[b][1] += int(bool(h))
    series = []
    for b in sorted(buckets):
        n, h = buckets[b]
        series.append({"period_start": (start + timedelta(days=b * bucket_days)).strftime("%d %b"),
                       "inspected": n, "defective": h, "rate": round(h / n, 4) if n else 0})
    return {"defect_type": defect_type, "bucket_days": bucket_days, "series": series}


def defect_profile(db: Session, part_id: str, defect_type: str = "porosity", days: int = 42) -> dict:
    rows = db.execute(
        select(Defect.zone, Defect.max_dim_mm, Defect.severity)
        .join(Inspection).where(_base(part_id, days), Defect.type == defect_type)
    ).all()
    zones: dict[str, int] = defaultdict(int)
    sizes = sorted(r[1] for r in rows)
    critical = sum(1 for r in rows if r[2] == "critical")
    for r in rows:
        zones[r[0] or "-"] += 1
    pct = lambda q: round(sizes[min(len(sizes) - 1, int(q * len(sizes)))], 2) if sizes else 0
    return {"defect_type": defect_type, "count": len(rows), "critical": critical,
            "zones": dict(sorted(zones.items(), key=lambda kv: -kv[1])),
            "size_mm": {"p50": pct(0.5), "p90": pct(0.9), "max": sizes[-1] if sizes else 0}}


# ---------------------------------------------------------------- dashboard

def overview(db: Session, part_id: str, days: int = 30, heat_type: str = "any") -> dict:
    def kpis(d_from: int, d_to: int = 0):
        cond = _base(part_id, d_from, d_to)
        n = db.scalar(select(func.count()).where(cond)) or 0
        by = dict(db.execute(select(Inspection.verdict, func.count()).where(cond).group_by(Inspection.verdict)).all())
        return n, by

    n, by = kpis(7)
    pn, pby = kpis(14, 7)
    y = by.get("PASS", 0) / n if n else 0
    py = pby.get("PASS", 0) / pn if pn else 0
    scrap = by.get("FAIL", 0) / n if n else 0
    pscrap = pby.get("FAIL", 0) / pn if pn else 0

    pareto_rows = db.execute(
        select(Defect.type, func.count()).join(Inspection)
        .where(_base(part_id, days), Defect.severity != "ignore").group_by(Defect.type).order_by(func.count().desc())
    ).all()
    total_def = sum(c for _, c in pareto_rows) or 1
    cum = 0
    pareto = []
    for t, c in pareto_rows:
        cum += c
        pareto.append({"type": t, "count": c, "cum_share": round(cum / total_def, 3)})

    # daily series
    rows = db.execute(
        select(func.date(Inspection.created_at), Inspection.verdict, func.count())
        .where(_base(part_id, days)).group_by(func.date(Inspection.created_at), Inspection.verdict)
    ).all()
    daily: dict[str, dict] = defaultdict(lambda: {"inspected": 0, "PASS": 0, "FAIL": 0, "REWORK": 0, "REVIEW": 0})
    for d, v, c in rows:
        daily[d]["inspected"] += c
        daily[d][v] += c
    dtype = db.execute(
        select(func.date(Inspection.created_at), Defect.type, func.count()).join(Defect)
        .where(_base(part_id, days), Defect.severity != "ignore")
        .group_by(func.date(Inspection.created_at), Defect.type)
    ).all()
    for d, t, c in dtype:
        daily[d][t] = c
    series = []
    for d in sorted(daily):
        row = daily[d]
        row["date"] = d
        row["yield"] = round(row["PASS"] / row["inspected"], 4) if row["inspected"] else None
        series.append(row)

    heat = rate_by_pair(db, part_id, "machine", "shift", heat_type, days)
    hotspot = None
    for t in [r["type"] for r in pareto]:
        cell = rate_by_pair(db, part_id, "machine", "shift", t, days)["cells"]
        top = cell[0] if cell else None
        if top and top["lift"] >= 2 and top["z"] >= 4 and top["defective"] >= 8:
            if hotspot is None or top["z"] > hotspot["z"]:
                hotspot = top | {"defect_type": t}
    top = pareto[0]["type"] if pareto else None
    return {
        "kpis": {
            "inspected_7d": n, "inspected_prev_7d": pn,
            "yield_7d": round(y, 4), "yield_prev_7d": round(py, 4),
            "scrap_7d": round(scrap, 4), "scrap_prev_7d": round(pscrap, 4),
            "rework_7d": by.get("REWORK", 0), "review_7d": by.get("REVIEW", 0), "fail_7d": by.get("FAIL", 0),
            "top_defect": top,
        },
        "pareto": pareto,
        "daily": series,
        "heatmap": heat,
        "hotspot": hotspot,
    }
