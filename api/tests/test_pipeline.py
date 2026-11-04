import asyncio

import cv2
import numpy as np
import pytest

from app.db import Part, SessionLocal, init_db
from app.providers.base import Detection, PartGeometry, canonical_type
from app.providers.mock import MockSegmenter, find_part
from app.seed import PARTS, seed_history, seed_parts
from app.services import judge, rootcause
from app.services.measure import measure, zone_of
from app.services.synth import render


@pytest.fixture(scope="module")
def db():
    init_db()
    s = SessionLocal()
    seed_parts(s)
    seed_history(s, days=42, per_cell=14)
    yield s
    s.close()


def test_canonical_prompts():
    assert canonical_type("gas porosity") == "porosity"
    assert canonical_type("Hairline crack") == "crack"
    assert canonical_type("flash") == "burr"
    assert canonical_type("sand inclusion") == "sand_inclusion"


def test_measure_known_circle():
    gray = np.full((400, 400), 150, np.uint8)
    part = PartGeometry((200.0, 200.0), 180.0, np.ones((400, 400), np.uint8), "test")
    mask = np.zeros((400, 400), np.uint8)
    cv2.circle(mask, (200, 200), 10, 1, -1)  # 21 px across in the hub
    m = measure(Detection("crack", "crack", mask, 0.9), gray, part, mm_per_px=0.5)
    assert m["zone"] == "hub"
    assert 10.0 <= m["max_dim_mm"] <= 11.5
    assert zone_of(0.5) == "vane" and zone_of(0.95) == "rim" and zone_of(1.05) == "edge"


def test_detector_recall():
    seg = MockSegmenter()
    kinds = ["porosity", "crack", "burr", "scratch"]
    found = total = 0
    for i in range(24):
        c = render(300 + i, defects=[kinds[i % 4]])
        dets = seg.segment(c.image, kinds, None)
        g = c.defects[0]
        total += 1
        found += any(d.type == g.type and d.mask[g.center[1] - 12:g.center[1] + 12, g.center[0] - 12:g.center[0] + 12].any() for d in dets)
    assert found / total >= 0.8, f"recall {found}/{total}"


def test_clean_part_is_found_and_passes():
    c = render(21, defects=[])
    geom = find_part(cv2.cvtColor(c.image, cv2.COLOR_BGR2GRAY))
    assert abs(geom.radius - c.radius) < 6
    assert MockSegmenter().segment(c.image, ["porosity", "crack"], geom) == []


def _defect(type_, key, zone="vane", conf=0.9, lib=None):
    return {"id": "D1", "type": type_, "prompt": type_, "confidence": conf, "zone": zone, "location": f"{zone} at 3 o'clock",
            "max_dim_mm": key, "area_mm2": 1, "polygons": [], "bbox": [0, 0, 1, 1],
            "features": {"key_size_mm": key, "largest_pore_mm": key, "pore_count": 3, "protrusion_mm": key, "length_mm": 9},
            "library": lib or {}}


def test_rules_engine():
    rules = PARTS[0]["rules"]
    r = judge.evaluate([_defect("porosity", 3.1)], rules)
    assert r["verdict"] == "FAIL" and "2 mm limit" in r["summary"]
    assert judge.evaluate([_defect("porosity", 1.5)], rules)["verdict"] == "PASS"
    assert judge.evaluate([_defect("porosity", 1.5, zone="hub")], rules)["verdict"] == "FAIL"  # hub limit is 1 mm
    assert judge.evaluate([_defect("burr", 3.0, zone="edge")], rules)["verdict"] == "REWORK"
    assert judge.evaluate([_defect("scratch", 8.0)], rules)["verdict"] == "PASS"
    assert judge.evaluate([], rules)["summary"] == "Pass. No defects found."


def test_library_rejections_suppress_false_positive():
    rules = PARTS[0]["rules"]
    lib = {"confirmed": 0, "rejected": 2, "notes": ["shadow on vane"], "nearest": []}
    r = judge.evaluate([_defect("porosity", 3.1, lib=lib)], rules)
    assert r["verdict"] == "PASS"


def test_root_cause_finds_planted_signal(db):
    part = db.get(Part, "IMP-200")

    async def collect():
        return [e async for e in rootcause.investigate(db, part, "porosity")]

    events = asyncio.run(collect())
    report = next(e["report"] for e in events if e["type"] == "report")
    statement = report["d4_root_cause"]["statement"]
    assert "Furnace 2" in statement and "Shift C" in statement
    assert any(e["type"] == "tool_call" and e["tool"] == "rate_by_pair" for e in events)


def test_single_rejection_holds_for_review():
    rules = PARTS[0]["rules"]
    lib = {"confirmed": 0, "rejected": 1, "notes": [], "nearest": []}
    assert judge.evaluate([_defect("porosity", 3.1, lib=lib)], rules)["verdict"] == "REVIEW"
