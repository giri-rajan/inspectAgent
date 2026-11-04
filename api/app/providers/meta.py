"""Meta Model API client: SAM 3.1 (segmentation), Muse Spark (reasoning), Muse Voice Transcribe.

Endpoints per dev.meta.ai docs:
  SAM 3.1           POST {base}/responses              model=sam-3.1, input_text noun phrase + input_image
  Muse Spark        POST {base}/chat/completions       OpenAI-compatible, tools + json_schema
  Voice Transcribe  POST {base}/asr/transcribe         multipart: request (JSON) + audio (WAV)
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging

import cv2
import httpx
import numpy as np

from ..config import settings
from .base import Detection, PartGeometry, canonical_type
from .mock import geometry_from_mask
from .sam_codec import parse_output

log = logging.getLogger("inspectagent.meta")


class MetaAPIError(RuntimeError):
    pass


def _data_url(bgr: np.ndarray, max_side: int = 1280, quality: int = 90) -> str:
    h, w = bgr.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise MetaAPIError("could not encode image")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


class MetaClient:
    def __init__(self) -> None:
        self.base = settings.meta_api_base.rstrip("/")
        self.headers = {"Authorization": f"Bearer {settings.model_api_key}"}
        self.timeout = httpx.Timeout(settings.request_timeout, connect=10)

    # ------------------------------------------------------------------ SAM 3.1

    async def sam(self, bgr: np.ndarray, prompt: str) -> list[np.ndarray] | list:
        """Segment every instance of `prompt`. Returns [(mask, confidence)] at source resolution."""
        h, w = bgr.shape[:2]
        body = {
            "model": settings.sam_model,
            "input": [{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    # send full resolution so returned boxes are in source pixels
                    {"type": "input_image", "image_url": _data_url(bgr, max_side=max(h, w))},
                ],
            }],
            "metadata": {"include_confidence": "true", "mask_encoding": "one_bit"},
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base}/responses", json=body, headers=self.headers)
        if r.status_code >= 400:
            raise MetaAPIError(f"SAM 3.1 {r.status_code}: {r.text[:300]}")
        text = _responses_text(r.json())
        out = []
        for rec in parse_output(text):
            mask = rec.full_mask()
            if mask.shape != (h, w):
                mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
            if mask.any():
                out.append((mask, rec.confidence if rec.confidence is not None else 0.8))
        return out

    async def segment(self, bgr: np.ndarray, prompts: list[str]) -> list[Detection]:
        results = await asyncio.gather(*(self.sam(bgr, p) for p in prompts))
        dets = []
        for prompt, found in zip(prompts, results):
            dets += [Detection(prompt=prompt, type=canonical_type(prompt), mask=m, score=float(c)) for m, c in found]
        return dets

    async def part(self, bgr: np.ndarray, noun: str, fallback: str | None = None) -> PartGeometry | None:
        found = await self.sam(bgr, noun)
        if not found and fallback:
            found = await self.sam(bgr, fallback)
        if not found:
            return None
        mask = max(found, key=lambda mc: mc[0].sum())[0]
        return geometry_from_mask(mask, "sam-3.1")

    # ------------------------------------------------------------------ Muse Spark

    async def chat(self, messages: list[dict], tools: list[dict] | None = None,
                   schema: dict | None = None, temperature: float = 0.2) -> dict:
        body: dict = {"model": settings.muse_spark_model, "messages": messages, "temperature": temperature}
        if tools:
            body["tools"] = tools
        if schema:
            body["response_format"] = {"type": "json_schema", "json_schema": schema}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base}/chat/completions", json=body, headers=self.headers)
        if r.status_code >= 400:
            raise MetaAPIError(f"Muse Spark {r.status_code}: {r.text[:300]}")
        return r.json()["choices"][0]["message"]

    async def chat_json(self, messages: list[dict], schema: dict) -> dict:
        msg = await self.chat(messages, schema=schema)
        content = msg.get("content") or ""
        if isinstance(content, list):
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            start, end = content.find("{"), content.rfind("}")
            if start >= 0 and end > start:
                return json.loads(content[start : end + 1])
            raise MetaAPIError("Muse Spark returned non-JSON content")

    # ------------------------------------------------------------------ Voice

    async def transcribe(self, wav: bytes) -> str:
        req = json.dumps({"model": settings.transcribe_model, "audioEncoding": "WAV", "mode": "PUSH_TO_TALK"})
        files = {
            "request": (None, req, "application/json"),
            "audio": ("note.wav", wav, "audio/wav"),
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base}/asr/transcribe", files=files,
                                  headers={**self.headers, "Accept": "text/plain"})
        if r.status_code >= 400:
            raise MetaAPIError(f"Transcribe {r.status_code}: {r.text[:300]}")
        return " ".join(line.strip() for line in r.text.splitlines() if line.strip())


def image_part(bgr: np.ndarray) -> dict:
    """Chat-completions image content part."""
    return {"type": "image_url", "image_url": {"url": _data_url(bgr, max_side=1024, quality=85)}}


def _responses_text(payload: dict) -> str:
    """Concatenate output_text from a (non-streamed) Responses API result."""
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    chunks = []
    for item in payload.get("output", []):
        for part in item.get("content", []) or []:
            if part.get("type") in ("output_text", "text"):
                chunks.append(part.get("text", ""))
    return "\n".join(chunks)
