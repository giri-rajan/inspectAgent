"""Seed parts, sample photos and six weeks of production history.

History carries two planted signals so the root-cause agent has something real to find:
  * porosity concentrates on Furnace 2 during the night shift (C)
  * Supplier B pig iron, introduced three weeks ago, lifts porosity on every furnace
Run:  python -m app.seed  [--reset]
"""
from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timedelta

import cv2
from sqlalchemy import delete, func, select

from .config import settings
from .db import Defect, Inspection, Part, SessionLocal, init_db
from .services.synth import render

PARTS = [
    {
        "id": "IMP-200", "name": "Pump Impeller", "material": "Grey cast iron FG260", "process": "Green-sand casting",
        "diameter_mm": 180.0,
        "description": "Closed impeller for 5 HP monoblock pumps. Hub is press-fit on the motor shaft; vanes see full head pressure.",
        "prompts": ["porosity", "crack", "burr", "scratch"],
        "rules": [
            {"id": "R1", "text": "Any crack is a reject - pressure-bearing part.", "defect_type": "crack", "zone": None, "max_size_mm": None, "action": "reject"},
            {"id": "R2", "text": "Reject if any pore in the hub exceeds 1 mm (press-fit and sealing area).", "defect_type": "porosity", "zone": "hub", "max_size_mm": 1.0, "action": "reject"},
            {"id": "R3", "text": "Reject if any hole is bigger than 2 mm.", "defect_type": "porosity", "zone": None, "max_size_mm": 2.0, "action": "reject"},
            {"id": "R4", "text": "Burrs or flash over 2 mm on the rim must be fettled before dispatch.", "defect_type": "burr", "zone": None, "max_size_mm": 2.0, "action": "rework"},
            {"id": "R5", "text": "Small surface scratches are acceptable; scratches longer than 15 mm need review.", "defect_type": "scratch", "zone": None, "max_size_mm": 15.0, "action": "review"},
        ],
    },
    {
        "id": "VB-110", "name": "Valve Body Flange", "material": "Ductile iron SG500/7", "process": "Shell moulding",
        "diameter_mm": 110.0,
        "description": "Flange face for gate valves. Sealing face must be porosity-free.",
        "prompts": ["porosity", "crack", "burr"],
        "rules": [
            {"id": "R1", "text": "Any crack is a reject.", "defect_type": "crack", "zone": None, "max_size_mm": None, "action": "reject"},
            {"id": "R2", "text": "No porosity allowed on the sealing rim.", "defect_type": "porosity", "zone": "rim", "max_size_mm": None, "action": "reject"},
            {"id": "R3", "text": "Reject pores bigger than 1.5 mm anywhere else.", "defect_type": "porosity", "zone": None, "max_size_mm": 1.5, "action": "reject"},
            {"id": "R4", "text": "Burrs over 1 mm must be removed.", "defect_type": "burr", "zone": None, "max_size_mm": 1.0, "action": "rework"},
        ],
    },
    {
        "id": "MC-150", "name": "Motor End Cover", "material": "Aluminium LM6", "process": "Gravity die casting",
        "diameter_mm": 150.0,
        "description": "Non-pressure cover. Cosmetic marks acceptable, structural defects are not.",
        "prompts": ["porosity", "crack", "scratch"],
        "rules": [
            {"id": "R1", "text": "Cracks longer than 3 mm are a reject.", "defect_type": "crack", "zone": None, "max_size_mm": 3.0, "action": "reject"},
            {"id": "R2", "text": "Reject pores bigger than 3 mm.", "defect_type": "porosity", "zone": None, "max_size_mm": 3.0, "action": "reject"},
            {"id": "R3", "text": "Scratches up to 25 mm are cosmetic.", "defect_type": "scratch", "zone": None, "max_size_mm": 25.0, "action": "review"},
        ],
    },
]

SAMPLES = [
    ("Clean casting", []), ("Porosity near vane", ["porosity"]), ("Crack + burr", ["crack", "burr"]),
    ("Scratch only", ["scratch"]), ("Rim burr", ["burr"]), ("Porosity + scratch", ["porosity", "scratch"]),
    ("Hairline crack", ["crack"]), ("Clean casting", []), ("Gas porosity", ["porosity", "porosity"]),
    ("Mixed defects", ["porosity", "crack", "scratch"]), ("Clean casting", []), ("Flash on edge", ["burr", "scratch"]),
]

MACHINES = ["Furnace 1", "Furnace 2", "Furnace 3"]
SHIFTS = ["A", "B", "C"]  # A 06-14, B 14-22, C 22-06 (night)
SHIFT_START = {"A": 6, "B": 14, "C": 22}
SUPPLIERS = ["Supplier A", "Supplier B", "Supplier C"]
OPERATORS = ["OP-11", "OP-12", "OP-21", "OP-22", "OP-31", "OP-32"]


def seed_parts(db) -> None:
    for p in PARTS:
        if db.get(Part, p["id"]) is None:
            db.add(Part(**p))
    db.commit()


def seed_samples() -> None:
    out = settings.data_dir / "samples"
    index = []
    kaggle = sorted((out / "kaggle").glob("*.jp*g")) if (out / "kaggle").exists() else []
    for i, (title, defects) in enumerate(SAMPLES):
        name = f"sample_{i + 1:02d}.jpg"
        if not (out / name).exists():
            cv2.imwrite(str(out / name), render(1000 + i * 7, defects=defects).image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        index.append({"file": f"samples/{name}", "title": title, "part_id": "IMP-200", "source": "synthetic"})
    for k in kaggle[:24]:
        index.append({"file": f"samples/kaggle/{k.name}", "title": "Kaggle " + ("defect" if "def" in k.name else "ok"),
                      "part_id": "IMP-200", "source": "kaggle"})
    (out / "index.json").write_text(json.dumps(index, indent=1))


def seed_history(db, days: int = 42, per_cell: int = 22, seed: int = 7) -> int:
    rng = random.Random(seed)
    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    start = (now - timedelta(days=days)).replace(hour=0)
    supplier_b_from = now - timedelta(days=21)
    heat = 0
    rows = 0
    for day in range(days):
        date = start + timedelta(days=day)
        for shift in SHIFTS:
            for mi, machine in enumerate(MACHINES):
                heat += 1
                if date >= supplier_b_from:
                    supplier = rng.choices(SUPPLIERS, [0.25, 0.5, 0.25])[0]
                else:
                    supplier = rng.choices(["Supplier A", "Supplier C"], [0.6, 0.4])[0]
                batch = f"H{date:%y%m%d}-{mi + 1}{shift}"
                operator = OPERATORS[mi * 2 + (0 if shift != "C" else 1)]
                n = per_cell + rng.randint(-4, 4)
                for k in range(n):
                    ts = date + timedelta(hours=SHIFT_START[shift], minutes=int(k * 480 / n) + rng.randint(0, 9))
                    if ts > now:
                        continue
                    p_por = 0.022
                    if machine == "Furnace 2" and shift == "C":
                        p_por *= 4.2
                    if supplier == "Supplier B":
                        p_por *= 1.9
                    rates = {"porosity": p_por, "crack": 0.006, "burr": 0.028 if machine != "Furnace 3" else 0.04, "scratch": 0.018}
                    found = [t for t, p in rates.items() if rng.random() < p]
                    defects = [_history_defect(rng, t) for t in found]
                    verdict = "PASS"
                    for d in defects:
                        v = {"reject": "FAIL", "rework": "REWORK", "review": "REVIEW", "accept": "PASS"}[d.features["disposition"]]
                        if ["PASS", "REVIEW", "REWORK", "FAIL"].index(v) > ["PASS", "REVIEW", "REWORK", "FAIL"].index(verdict):
                            verdict = v
                    db.add(Inspection(part_id="IMP-200", created_at=ts, source="history", verdict=verdict,
                                      summary="", provider="history", machine=machine, shift=shift, batch=batch,
                                      supplier=supplier, operator=operator, defects=defects))
                    rows += 1
        db.commit()
    return rows


def _history_defect(rng: random.Random, t: str) -> Defect:
    zone = rng.choices(["hub", "vane", "rim"], [0.35, 0.5, 0.15])[0] if t != "burr" else "edge"
    if t == "porosity":
        size = round(rng.lognormvariate(0.85, 0.45), 2)
        limit = 1.0 if zone == "hub" else 2.0
        disp = "reject" if size > limit else "accept"
        feats = {"largest_pore_mm": size, "key_size_mm": size, "pore_count": rng.randint(1, 9)}
        rule = ("R2" if zone == "hub" else "R3") if disp == "reject" else None
    elif t == "crack":
        size = round(rng.uniform(4, 30), 1)
        disp, rule, feats = "reject", "R1", {"key_size_mm": size}
    elif t == "burr":
        size = round(rng.uniform(1, 9), 1)
        disp = "rework" if size > 2 else "accept"
        rule, feats = ("R4" if disp == "rework" else None), {"key_size_mm": size}
    else:
        size = round(rng.uniform(3, 25), 1)
        disp = "review" if size > 15 else "accept"
        rule, feats = ("R5" if disp == "review" else None), {"key_size_mm": size}
    sev = {"reject": "critical", "rework": "major", "review": "major", "accept": "minor"}[disp]
    feats["disposition"] = disp
    return Defect(type=t, confidence=round(rng.uniform(0.7, 0.97), 2), max_dim_mm=size, zone=zone,
                  severity=sev, rule_id=rule, features=feats, status="pending")


def main(reset: bool = False) -> None:
    init_db()
    with SessionLocal() as db:
        if reset:
            db.execute(delete(Defect))
            db.execute(delete(Inspection))
            db.execute(delete(Part))
            db.commit()
        seed_parts(db)
        seed_samples()
        has_history = db.scalar(select(func.count()).select_from(Inspection).where(Inspection.source == "history"))
        if not has_history:
            n = seed_history(db)
            print(f"seeded {n} historical inspections")
    print("seed complete:", settings.db_url)


if __name__ == "__main__":
    main(reset="--reset" in sys.argv)
