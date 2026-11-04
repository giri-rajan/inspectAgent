"""Photo -> SAM 3.1 masks -> measurements -> Muse Spark verdict -> stored inspection."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime

import cv2
import numpy as np
from sqlalchemy.orm import Session

from ..config import settings
from ..db import Defect, Inspection, Part
from ..providers.meta import MetaClient
from ..providers.mock import MockSegmenter, _dedupe, find_part
from . import judge, library
from .measure import measure, scale_for

log = logging.getLogger("inspectagent.pipeline")
MAX_SIDE = 1280
# SAM 3.1 segments what things look like, not inspection jargon: on castings it rarely answers
# "porosity" or "burr" and fires on vanes for "dark line". So the calibrated OpenCV detector
# always runs and SAM masks are merged in only when confident and on the part.
SAM_MIN_SCORE = 0.7


def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Unsupported image")
    h, w = bgr.shape[:2]
    s = min(1.0, MAX_SIDE / max(h, w))
    if s < 1:
        bgr = cv2.resize(bgr, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return bgr


def part_dict(p: Part) -> dict:
    return {"id": p.id, "name": p.name, "material": p.material, "process": p.process,
            "diameter_mm": p.diameter_mm, "description": p.description, "prompts": p.prompts, "rules": p.rules}


async def run(db: Session, image: bytes, part: Part, prompts: list[str], context: dict) -> Inspection:
    timings: dict[str, int] = {}
    warnings: list[str] = []
    t0 = time.perf_counter()
    bgr = decode_image(image)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    use_meta = settings.use_meta
    client = MetaClient() if use_meta else None
    provider = "meta" if use_meta else "mock"

    # 1. segmentation (SAM 3.1): the part silhouette for scale, and each defect prompt
    t = time.perf_counter()
    geom = None
    if client:
        try:
            geom_task = client.part(bgr, f"{part.name.lower()} casting", fallback="metal disc")
            seg_task = client.segment(bgr, prompts)
            geom, sam_dets = await asyncio.gather(geom_task, seg_task)
        except Exception as e:  # network / quota: keep the line running
            log.warning("SAM 3.1 failed, falling back to OpenCV: %s", e)
            warnings.append(f"SAM 3.1 unavailable ({type(e).__name__}); used offline segmenter.")
            client, provider = None, "mock"
    if geom is None:
        geom = find_part(gray)
    # SAM's silhouette cuts defects out of the part as holes, so the detector keeps its own outline
    dets = MockSegmenter().segment(bgr, prompts, find_part(gray) or geom)
    if client:
        on_part = geom.mask if geom is not None else None
        dets = _dedupe(dets + [
            d for d in sam_dets
            if d.score >= SAM_MIN_SCORE and (on_part is None or (d.mask & on_part).sum() > 0.8 * d.mask.sum())
        ])
    timings["segment_ms"] = int((time.perf_counter() - t) * 1000)

    # 2. measurement
    t = time.perf_counter()
    mm_per_px = scale_for(geom, part.diameter_mm, w)
    lib = library.exemplars(db, part.id)
    defects = []
    for i, det in enumerate(sorted(dets, key=lambda d: -d.mask.sum())):
        if det.mask.sum() < 4:
            continue
        m = measure(det, gray, geom, mm_per_px)
        m["id"] = f"D{i + 1}"
        m["library"] = library.match(m, lib)
        defects.append(m)
    timings["measure_ms"] = int((time.perf_counter() - t) * 1000)

    # 3. judgment (rule engine always; Muse Spark when available)
    t = time.perf_counter()
    result = judge.evaluate(defects, part.rules)
    if client and defects:
        try:
            result = await judge.judge_with_spark(client, bgr, part_dict(part), defects, result)
        except Exception as e:
            log.warning("Muse Spark failed, keeping rule-engine verdict: %s", e)
            warnings.append(f"Muse Spark unavailable ({type(e).__name__}); rule-engine verdict shown.")
    timings["judge_ms"] = int((time.perf_counter() - t) * 1000)
    timings["total_ms"] = int((time.perf_counter() - t0) * 1000)

    # 4. persist
    key = uuid.uuid4().hex[:12]
    rel = f"uploads/{key}.jpg"
    cv2.imwrite(str(settings.data_dir / rel), bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
    insp = Inspection(
        part_id=part.id, created_at=datetime.now(), source="live", image_path=rel, width=w, height=h,
        verdict=result["verdict"], summary=result["summary"], provider=provider,
        machine=context.get("machine", ""), shift=context.get("shift", ""), batch=context.get("batch", ""),
        supplier=context.get("supplier", ""), operator=context.get("operator", ""), note=context.get("note", ""),
        meta={
            "engine": result["engine"], "prompts": prompts, "timings": timings, "warnings": warnings,
            "mm_per_px": round(mm_per_px, 4),
            "part_circle": {"cx": geom.center[0], "cy": geom.center[1], "r": geom.radius, "method": geom.method} if geom else None,
        },
    )
    for d in defects:
        x1, y1, x2, y2 = d["bbox"]
        pad = max(16, int(0.4 * max(x2 - x1, y2 - y1)))
        crop = bgr[max(0, y1 - pad): y2 + pad, max(0, x1 - pad): x2 + pad]
        crop_rel = f"uploads/{key}_{d['id']}.jpg"
        cv2.imwrite(str(settings.data_dir / crop_rel), crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
        feats = dict(d["features"], label=d["id"], location=d["location"], prompt=d["prompt"],
                     disposition=d["disposition"], library=d["library"])
        insp.defects.append(Defect(
            type=d["type"], confidence=d["confidence"], bbox=d["bbox"], polygons=d["polygons"],
            area_mm2=d["area_mm2"], max_dim_mm=d["max_dim_mm"], zone=d["zone"], features=feats,
            severity=d["severity"], rule_id=d.get("rule_id"), reason=d["reason"], crop_path=crop_rel,
        ))
    db.add(insp)
    db.commit()
    db.refresh(insp)
    return insp
