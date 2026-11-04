from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from .config import settings
from .db import Defect, Inspection, Part, SessionLocal, init_db
from .providers.meta import MetaClient
from .services import analytics, pipeline, report, rootcause

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title="InspectAgent API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_methods=["*"], allow_headers=["*"])
app.mount("/files", StaticFiles(directory=settings.data_dir), name="files")


@app.on_event("startup")
def _startup() -> None:
    init_db()
    from . import seed

    with SessionLocal() as db:
        if not db.scalar(select(func.count()).select_from(Part)):
            seed.main()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _part(db: Session, part_id: str) -> Part:
    p = db.get(Part, part_id)
    if p is None:
        raise HTTPException(404, f"Unknown part {part_id}")
    return p


def ser_defect(d: Defect) -> dict:
    f = d.features or {}
    return {
        "id": d.id, "label": f.get("label", f"D{d.id}"), "type": d.type, "prompt": f.get("prompt", d.type),
        "confidence": d.confidence, "bbox": d.bbox, "polygons": d.polygons, "area_mm2": d.area_mm2,
        "max_dim_mm": d.max_dim_mm, "zone": d.zone, "location": f.get("location", d.zone), "severity": d.severity,
        "disposition": f.get("disposition"), "rule_id": d.rule_id, "reason": d.reason, "status": d.status,
        "feedback": d.feedback, "features": {k: v for k, v in f.items() if k not in ("library",)},
        "library": f.get("library", {}), "crop_url": f"/files/{d.crop_path}" if d.crop_path else None,
        "reviewed_at": d.reviewed_at.isoformat() if d.reviewed_at else None,
    }


def ser_inspection(i: Inspection, with_defects: bool = True) -> dict:
    out = {
        "id": i.id, "part_id": i.part_id, "created_at": i.created_at.isoformat(), "source": i.source,
        "image_url": f"/files/{i.image_path}" if i.image_path else None, "width": i.width, "height": i.height,
        "verdict": i.verdict, "summary": i.summary, "provider": i.provider, "machine": i.machine, "shift": i.shift,
        "batch": i.batch, "supplier": i.supplier, "operator": i.operator, "note": i.note, "meta": i.meta or {},
        "defect_count": len(i.defects),
    }
    if with_defects:
        out["defects"] = [ser_defect(d) for d in i.defects]
    return out


# ---------------------------------------------------------------- meta

@app.get("/api/health")
def health():
    return {
        "ok": True, "provider": "meta" if settings.use_meta else "mock",
        "models": {"segmentation": settings.sam_model if settings.use_meta else "opencv-fallback",
                   "reasoning": settings.muse_spark_model if settings.use_meta else "rule-engine",
                   "voice": settings.transcribe_model if settings.use_meta else None},
        "has_key": bool(settings.model_api_key),
    }


# ---------------------------------------------------------------- parts

class PartUpdate(BaseModel):
    name: str | None = None
    material: str | None = None
    process: str | None = None
    diameter_mm: float | None = None
    description: str | None = None
    prompts: list[str] | None = None
    rules: list[dict] | None = None


@app.get("/api/parts")
def list_parts(db: Session = Depends(get_db)):
    parts = db.scalars(select(Part).order_by(Part.id)).all()
    counts = dict(db.execute(select(Inspection.part_id, func.count()).group_by(Inspection.part_id)).all())
    return [pipeline.part_dict(p) | {"inspections": counts.get(p.id, 0)} for p in parts]


@app.get("/api/parts/{part_id}")
def get_part(part_id: str, db: Session = Depends(get_db)):
    return pipeline.part_dict(_part(db, part_id))


@app.put("/api/parts/{part_id}")
def update_part(part_id: str, body: PartUpdate, db: Session = Depends(get_db)):
    p = _part(db, part_id)
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "rules":
            for r in v:
                if r.get("action") not in ("reject", "rework", "review", "accept"):
                    raise HTTPException(422, f"Rule {r.get('id')}: invalid action")
                r.setdefault("zone", None)
                r.setdefault("max_size_mm", None)
        setattr(p, k, v)
    db.commit()
    return pipeline.part_dict(p)


@app.get("/api/samples")
def samples():
    path = settings.data_dir / "samples" / "index.json"
    items = json.loads(path.read_text()) if path.exists() else []
    return [s | {"url": f"/files/{s['file']}"} for s in items]


# ---------------------------------------------------------------- inspection

@app.post("/api/inspect")
async def inspect(
    image: UploadFile = File(...), part_id: str = Form("IMP-200"), prompts: str = Form(""),
    machine: str = Form(""), shift: str = Form(""), batch: str = Form(""), supplier: str = Form(""),
    operator: str = Form(""), note: str = Form(""), db: Session = Depends(get_db),
):
    p = _part(db, part_id)
    plist = [x.strip() for x in prompts.split(",") if x.strip()] or p.prompts
    data = await image.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "Image too large")
    try:
        insp = await pipeline.run(db, data, p, plist[:8], {
            "machine": machine, "shift": shift, "batch": batch, "supplier": supplier, "operator": operator, "note": note})
    except ValueError as e:
        raise HTTPException(400, str(e))
    return ser_inspection(insp)


@app.get("/api/inspections")
def inspections(part_id: str | None = None, source: str = "live", limit: int = 30, db: Session = Depends(get_db)):
    q = select(Inspection).where(Inspection.source == source).order_by(Inspection.created_at.desc()).limit(min(limit, 200))
    if part_id:
        q = q.where(Inspection.part_id == part_id)
    return [ser_inspection(i) for i in db.scalars(q).all()]


@app.get("/api/inspections/{insp_id}")
def inspection(insp_id: int, db: Session = Depends(get_db)):
    i = db.get(Inspection, insp_id)
    if i is None:
        raise HTTPException(404)
    return ser_inspection(i)


@app.patch("/api/inspections/{insp_id}")
def annotate(insp_id: int, body: dict, db: Session = Depends(get_db)):
    i = db.get(Inspection, insp_id)
    if i is None:
        raise HTTPException(404)
    if "note" in body:
        i.note = str(body["note"])[:2000]
    db.commit()
    return ser_inspection(i)


class Review(BaseModel):
    status: str  # confirmed | rejected | pending
    feedback: str = ""


@app.post("/api/defects/{defect_id}/review")
def review(defect_id: int, body: Review, db: Session = Depends(get_db)):
    d = db.get(Defect, defect_id)
    if d is None:
        raise HTTPException(404)
    if body.status not in ("confirmed", "rejected", "pending"):
        raise HTTPException(422, "status must be confirmed, rejected or pending")
    d.status = body.status
    d.feedback = body.feedback[:500]
    d.reviewed_at = datetime.now() if body.status != "pending" else None
    db.commit()
    return ser_defect(d)


@app.get("/api/library")
def library(part_id: str = "IMP-200", db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Defect).join(Inspection)
        .where(Inspection.part_id == part_id, Defect.status.in_(("confirmed", "rejected")))
        .order_by(Defect.reviewed_at.desc())
    ).all()
    stats: dict[str, dict] = {}
    for d in rows:
        s = stats.setdefault(d.type, {"type": d.type, "confirmed": 0, "rejected": 0})
        s[d.status] += 1
    pending = db.scalar(
        select(func.count()).select_from(Defect).join(Inspection)
        .where(Inspection.part_id == part_id, Inspection.source == "live", Defect.status == "pending"))
    return {"items": [ser_defect(d) | {"inspection_id": d.inspection_id} for d in rows],
            "stats": sorted(stats.values(), key=lambda s: -(s["confirmed"] + s["rejected"])), "pending": pending}


# ---------------------------------------------------------------- analytics & agent

@app.get("/api/analytics/overview")
def overview(part_id: str = "IMP-200", days: int = 30, heat_type: str = "any", db: Session = Depends(get_db)):
    _part(db, part_id)
    return analytics.overview(db, part_id, days, heat_type)


@app.get("/api/analytics/rate_by")
def rate_by(part_id: str = "IMP-200", dimension: str = "machine", defect_type: str = "porosity", days: int = 42,
            db: Session = Depends(get_db)):
    try:
        return analytics.rate_by(db, part_id, dimension, defect_type, days)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/rootcause/stream")
async def rootcause_stream(part_id: str = "IMP-200", defect_type: str = "porosity", days: int = 42):
    async def gen():
        db = SessionLocal()
        try:
            p = _part(db, part_id)
            async for ev in rootcause.investigate(db, p, defect_type, days):
                yield {"event": "message", "data": json.dumps(ev, default=str)}
        except Exception as e:  # surface to the UI instead of a dead stream
            logging.exception("root cause failed")
            yield {"event": "message", "data": json.dumps({"type": "error", "text": str(e)})}
        finally:
            db.close()

    return EventSourceResponse(gen())


@app.post("/api/reports/8d/pdf")
def report_pdf(body: dict):
    pdf = report.render_pdf(body)
    name = f"8D_{body.get('part', {}).get('id', 'part')}_{body.get('defect_type', 'defect')}.pdf"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/api/voice")
async def voice(audio: UploadFile = File(...)):
    if not settings.use_meta:
        raise HTTPException(503, "Voice notes need a Meta Model API key (Muse Voice Transcribe).")
    try:
        text = await MetaClient().transcribe(await audio.read())
    except Exception as e:
        raise HTTPException(502, f"Transcription failed: {e}")
    return {"text": text}
