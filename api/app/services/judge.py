"""Verdicts: a deterministic rule engine grounds every decision, Muse Spark reasons over it.

The rule engine always runs (it is the offline fallback and the evidence we hand the model).
With a Meta key, Muse Spark sees the annotated photo, the measurements, the part's rules and
similar engineer-reviewed examples, and returns the final structured verdict.
"""
from __future__ import annotations

import json
import logging

import cv2
import numpy as np

from ..providers.meta import MetaClient, image_part

log = logging.getLogger("inspectagent.judge")

VERDICT_ORDER = ["PASS", "REVIEW", "REWORK", "FAIL"]
ACTION_TO_VERDICT = {"reject": "FAIL", "rework": "REWORK", "review": "REVIEW", "accept": "PASS"}
ACTION_TO_SEVERITY = {"reject": "critical", "rework": "major", "review": "major", "accept": "minor"}
TYPE_NOUN = {"porosity": "porosity cluster", "crack": "crack", "burr": "burr", "scratch": "scratch"}


def _size_phrase(d: dict) -> str:
    f = d["features"]
    if d["type"] == "porosity":
        n = f.get("pore_count", 1)
        return f"{f['largest_pore_mm']:.1f} mm pore" + (f" ({n} pores)" if n > 1 else "")
    if d["type"] == "burr":
        return f"{f['protrusion_mm']:.1f} mm high burr ({f.get('length_mm', d['max_dim_mm']):.0f} mm along the edge)"
    return f"{d['max_dim_mm']:.1f} mm {TYPE_NOUN.get(d['type'], d['type'])}"


def _rule_applies(rule: dict, d: dict) -> bool:
    if rule.get("defect_type") not in (d["type"], "any"):
        return False
    return not rule.get("zone") or rule["zone"] == d["zone"]


def _violates(rule: dict, d: dict) -> bool:
    limit = rule.get("max_size_mm")
    if limit is None:
        return True  # presence-based rule
    return d["features"]["key_size_mm"] > float(limit)


def evaluate(defects: list[dict], rules: list[dict]) -> dict:
    """Pure rule evaluation. Mutates each defect with severity/rule_id/reason; returns verdict + summary."""
    worst = "PASS"
    for d in defects:
        applicable = [r for r in rules if _rule_applies(r, d)]
        hits = [r for r in applicable if _violates(r, d)]
        lib = d.get("library", {})
        if hits:
            hit = max(hits, key=lambda r: VERDICT_ORDER.index(ACTION_TO_VERDICT[r["action"]]))
            action = hit["action"]
            limit = hit.get("max_size_mm")
            size = d["features"]["key_size_mm"]
            if limit is None:
                reason = f"{TYPE_NOUN.get(d['type'], d['type']).capitalize()} {d['location']}: {hit['text']}"
            elif action == "accept":
                reason = f"{_size_phrase(d)} {d['location']} is within the cosmetic allowance."
            else:
                reason = f"{_size_phrase(d)} {d['location']} exceeds the {limit:g} mm limit ({size:.1f} > {limit:g} mm)."
            d.update(rule_id=hit["id"], severity=ACTION_TO_SEVERITY[action], disposition=action, reason=reason)
        else:
            within = [r for r in applicable if r.get("max_size_mm") is not None]
            if within:
                lim = min(float(r["max_size_mm"]) for r in within)
                d.update(rule_id=None, severity="minor", disposition="accept",
                         reason=f"{_size_phrase(d)} {d['location']} is within the {lim:g} mm limit.")
            else:
                d.update(rule_id=None, severity="major", disposition="review",
                         reason=f"{_size_phrase(d)} {d['location']} is not covered by a rule; needs an engineer's eye.")
        # library: engineers have rejected look-alikes before -> treat as likely false positive
        rej, conf = lib.get("rejected", 0), lib.get("confirmed", 0)
        if rej > conf and rej >= 1:
            why = f" (\"{lib['notes'][0]}\")" if lib.get("notes") else ""
            if rej >= 2:
                d.update(severity="ignore", disposition="accept",
                         reason=d["reason"] + f" Likely false positive: engineers rejected {rej} similar detections{why}.")
            elif d["disposition"] in ("reject", "rework"):
                # one rejection is a hint, not proof: hold for a human instead of scrapping
                d.update(severity="major", disposition="review",
                         reason=d["reason"] + f" An engineer rejected a similar detection{why}, so holding for review.")
        elif lib.get("confirmed", 0) >= 1:
            d["reason"] += f" Matches {lib['confirmed']} engineer-confirmed defect(s) in the library."
        if d["confidence"] < 0.5 and d["disposition"] in ("reject", "rework"):
            d.update(disposition="review", severity="major", reason=d["reason"] + " Low segmentation confidence - flagged for review.")
        v = ACTION_TO_VERDICT[d["disposition"]]
        if VERDICT_ORDER.index(v) > VERDICT_ORDER.index(worst):
            worst = v
    return {"verdict": worst, "summary": summarize(worst, defects), "engine": "rules"}


def summarize(verdict: str, defects: list[dict]) -> str:
    def first(disp):
        return next((d for d in sorted(defects, key=lambda d: -d["features"]["key_size_mm"]) if d["disposition"] == disp), None)

    if verdict == "FAIL":
        d = first("reject")
        extra = sum(1 for x in defects if x["disposition"] == "reject") - 1
        tail = f" Plus {extra} other defect{'s' if extra > 1 else ''} over {'their' if extra > 1 else 'its'} limit." if extra > 0 else ""
        return f"Fail. {d['reason']}{tail}"
    if verdict == "REWORK":
        d = first("rework")
        return f"Rework. {d['reason']} Send to fettling, then re-inspect."
    if verdict == "REVIEW":
        d = first("review")
        return f"Hold for review. {d['reason']}"
    if defects:
        return f"Pass. {len(defects)} minor indication(s), all within limits."
    return "Pass. No defects found."


# ---------------------------------------------------------------- Muse Spark

VERDICT_SCHEMA = {
    "name": "inspection_verdict",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "verdict": {"type": "string", "enum": VERDICT_ORDER},
            "summary": {"type": "string", "description": "One or two plain-English sentences for the operator, starting with the verdict word."},
            "defects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "id": {"type": "string"},
                        "disposition": {"type": "string", "enum": ["reject", "rework", "review", "accept"]},
                        "severity": {"type": "string", "enum": ["critical", "major", "minor", "ignore"]},
                        "rule_id": {"type": ["string", "null"]},
                        "reason": {"type": "string"},
                    },
                    "required": ["id", "disposition", "severity", "rule_id", "reason"],
                },
            },
        },
        "required": ["verdict", "summary", "defects"],
    },
}

SYSTEM = """You are InspectAgent, a senior foundry quality engineer judging one casting.
You receive: a photo with numbered defect outlines (from SAM 3.1), deterministic measurements in mm,
the part's acceptance rules, a rule-engine pre-assessment, and similar defects that engineers have
already confirmed or rejected. Decide each defect's disposition and the part verdict.
- Rules are binding: never pass a measured value that exceeds a reject limit.
- Use the photo to catch segmentation mistakes (shadows, sand grains, designed holes); if a detection
  looks like a false positive, mark it accept/ignore and say why.
- Library rejections are strong evidence of false positives; confirmations are evidence of real defects.
- Write for a shop-floor operator: short, specific, with sizes, location and the rule broken.
Verdicts: PASS, REVIEW (human check), REWORK (fixable, e.g. deburr), FAIL (scrap)."""


def annotate(bgr: np.ndarray, defects: list[dict]) -> np.ndarray:
    img = bgr.copy()
    for d in defects:
        for poly in d["polygons"]:
            cv2.polylines(img, [np.array(poly, np.int32)], True, (0, 200, 255), 2, cv2.LINE_AA)
        x1, y1 = d["bbox"][:2]
        cv2.putText(img, d["id"], (x1, max(14, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2, cv2.LINE_AA)
    return img


async def judge_with_spark(client: MetaClient, bgr: np.ndarray, part: dict, defects: list[dict], draft: dict) -> dict:
    facts = [{
        "id": d["id"], "type": d["type"], "prompt": d["prompt"], "confidence": d["confidence"],
        "location": d["location"], "zone": d["zone"], "max_dim_mm": d["max_dim_mm"], "area_mm2": d["area_mm2"],
        "features": d["features"], "rule_engine": {"disposition": d["disposition"], "rule_id": d.get("rule_id"), "reason": d["reason"]},
        "library_matches": d.get("library", {}),
    } for d in defects]
    user = (
        f"Part: {part['name']} ({part['id']}), {part['material']}, {part['diameter_mm']} mm diameter.\n"
        f"Rules:\n{json.dumps(part['rules'], indent=1)}\n\n"
        f"Detections:\n{json.dumps(facts, indent=1)}\n\n"
        f"Rule-engine draft verdict: {draft['verdict']} - {draft['summary']}"
    )
    msg = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": [{"type": "text", "text": user}, image_part(annotate(bgr, defects))]},
    ]
    out = await client.chat_json(msg, VERDICT_SCHEMA)
    by_id = {x["id"]: x for x in out.get("defects", [])}
    # rules are binding: the model may downgrade suspected false positives, but cannot wave through
    # a confident, library-unchallenged violation
    for d in defects:
        m = by_id.get(d["id"])
        if not m:
            continue
        hard = d["disposition"] == "reject" and d["confidence"] >= 0.7 and not d.get("library", {}).get("rejected")
        if hard and m["disposition"] != "reject":
            continue
        d.update(disposition=m["disposition"], severity=m["severity"], rule_id=m.get("rule_id"), reason=m["reason"])
    verdict = "PASS"
    for d in defects:
        v = ACTION_TO_VERDICT[d["disposition"]]
        if VERDICT_ORDER.index(v) > VERDICT_ORDER.index(verdict):
            verdict = v
    summary = out.get("summary") or summarize(verdict, defects)
    if verdict != out.get("verdict"):
        summary = summarize(verdict, defects)
    return {"verdict": verdict, "summary": summary, "engine": "muse-spark"}
