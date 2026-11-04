from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import settings

engine = create_engine(settings.db_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Part(Base):
    __tablename__ = "parts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    material: Mapped[str] = mapped_column(String, default="")
    process: Mapped[str] = mapped_column(String, default="")
    diameter_mm: Mapped[float] = mapped_column(Float)
    description: Mapped[str] = mapped_column(Text, default="")
    prompts: Mapped[list] = mapped_column(JSON, default=list)
    # [{id, text, defect_type, zone|None, max_size_mm|None, action: reject|review|accept}]
    rules: Mapped[list] = mapped_column(JSON, default=list)


class Inspection(Base):
    __tablename__ = "inspections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    part_id: Mapped[str] = mapped_column(ForeignKey("parts.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=datetime.now)
    source: Mapped[str] = mapped_column(String, default="live")  # live | history
    image_path: Mapped[str | None] = mapped_column(String, nullable=True)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    verdict: Mapped[str] = mapped_column(String, index=True)  # PASS | FAIL | REVIEW
    summary: Mapped[str] = mapped_column(Text, default="")
    provider: Mapped[str] = mapped_column(String, default="mock")
    machine: Mapped[str] = mapped_column(String, default="", index=True)
    shift: Mapped[str] = mapped_column(String, default="", index=True)
    batch: Mapped[str] = mapped_column(String, default="", index=True)
    supplier: Mapped[str] = mapped_column(String, default="", index=True)
    operator: Mapped[str] = mapped_column(String, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)  # part circle, scale, timings
    defects: Mapped[list["Defect"]] = relationship(back_populates="inspection", cascade="all, delete-orphan")


class Defect(Base):
    __tablename__ = "defects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id"), index=True)
    type: Mapped[str] = mapped_column(String, index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    bbox: Mapped[list] = mapped_column(JSON, default=list)  # [x1,y1,x2,y2]
    polygons: Mapped[list] = mapped_column(JSON, default=list)  # [[[x,y],...], ...]
    area_mm2: Mapped[float] = mapped_column(Float, default=0.0)
    max_dim_mm: Mapped[float] = mapped_column(Float, default=0.0)
    zone: Mapped[str] = mapped_column(String, default="")
    features: Mapped[dict] = mapped_column(JSON, default=dict)
    severity: Mapped[str] = mapped_column(String, default="minor")  # critical | major | minor | ignore
    rule_id: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="pending", index=True)  # pending | confirmed | rejected
    feedback: Mapped[str] = mapped_column(Text, default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    crop_path: Mapped[str | None] = mapped_column(String, nullable=True)
    inspection: Mapped[Inspection] = relationship(back_populates="defects")


def init_db() -> None:
    Base.metadata.create_all(engine)
