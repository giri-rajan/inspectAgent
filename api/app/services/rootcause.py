"""Root-cause agent: mines production history for a recurring defect and drafts an 8D/CAPA report.

With a Meta key, Muse Spark drives a tool-calling loop over the analytics tools. Offline, a
deterministic analyst runs the same tools in a fixed investigative order and reasons over the
numbers it gets back. Both stream the same events: thought | tool_call | tool_result | finding | report.
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime

from sqlalchemy.orm import Session

from ..config import settings
from ..db import Part
from ..providers.meta import MetaClient
from . import analytics as an

log = logging.getLogger("inspectagent.rootcause")

CAUSE_HINTS = {
    "porosity": {
        "machine": "melt practice on {v}: insufficient degassing, low pouring temperature or a damp ladle lining",
        "shift": "{v} practice: ladle preheat skipped, longer holding time before pouring, or relaxed degassing checks",
        "supplier": "charge material from {v}: rusty or oily scrap and high-hydrogen pig iron raise gas pickup",
        "operator": "pouring technique of {v}: turbulent pour or slow fill",
        "batch": "heat {v}: a single bad melt",
    },
    "crack": {
        "machine": "{v}: high pouring temperature or early shake-out causing hot tears",
        "shift": "{v}: shake-out timing / cooling practice",
        "supplier": "{v}: high sulphur or phosphorus in charge material",
        "operator": "{v}: handling damage during knock-out",
        "batch": "heat {v}: off-chemistry melt",
    },
    "burr": {
        "machine": "{v}: worn pattern plates or mould mismatch",
        "shift": "{v}: fettling capacity or mould closing practice",
        "supplier": "{v}: not a likely driver of flash",
        "operator": "{v}: mould closing / clamping practice",
        "batch": "heat {v}",
    },
    "scratch": {
        "machine": "{v}: conveyor or tumbling contact",
        "shift": "{v}: handling practice",
        "supplier": "{v}: unlikely to cause scratches",
        "operator": "{v}: handling",
        "batch": "lot {v}",
    },
}

TOOLS = [
    {"type": "function", "function": {
        "name": "trend", "description": "Weekly rate of inspections showing a defect type. Use first to size the problem.",
        "parameters": {"type": "object", "properties": {
            "defect_type": {"type": "string"}, "days": {"type": "integer", "default": 42}}, "required": ["defect_type"]}}},
    {"type": "function", "function": {
        "name": "rate_by", "description": "Defect rate, lift vs overall, share of defects and z-score grouped by one production dimension.",
        "parameters": {"type": "object", "properties": {
            "dimension": {"type": "string", "enum": list(an.DIMENSIONS)}, "defect_type": {"type": "string"},
            "days": {"type": "integer", "default": 42}}, "required": ["dimension", "defect_type"]}}},
    {"type": "function", "function": {
        "name": "rate_by_pair", "description": "Defect rate for every combination of two dimensions (e.g. machine x shift) to find interactions.",
        "parameters": {"type": "object", "properties": {
            "dim_a": {"type": "string", "enum": list(an.DIMENSIONS)}, "dim_b": {"type": "string", "enum": list(an.DIMENSIONS)},
            "defect_type": {"type": "string"}, "days": {"type": "integer", "default": 42}},
            "required": ["dim_a", "dim_b", "defect_type"]}}},
    {"type": "function", "function": {
        "name": "defect_profile", "description": "Where on the part the defect appears (zones) and its size distribution.",
        "parameters": {"type": "object", "properties": {
            "defect_type": {"type": "string"}, "days": {"type": "integer", "default": 42}}, "required": ["defect_type"]}}},
]

REPORT_SCHEMA = {
    "name": "eight_d_report",
    "schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "d1_team": {"type": "array", "items": {"type": "string"}},
            "d2_problem": {"type": "string"},
            "d3_containment": {"type": "array", "items": {"type": "string"}},
            "d4_root_cause": {"type": "object", "properties": {
                "statement": {"type": "string"},
                "evidence": {"type": "array", "items": {"type": "string"}},
                "five_whys": {"type": "array", "items": {"type": "string"}}},
                "required": ["statement", "evidence", "five_whys"]},
            "d5_corrective_actions": {"type": "array", "items": {"type": "object", "properties": {
                "action": {"type": "string"}, "owner": {"type": "string"}, "due": {"type": "string"}},
                "required": ["action", "owner", "due"]}},
            "d6_verification": {"type": "string"},
            "d7_prevention": {"type": "array", "items": {"type": "string"}},
            "d8_closure": {"type": "string"},
        },
        "required": ["title", "d1_team", "d2_problem", "d3_containment", "d4_root_cause",
                     "d5_corrective_actions", "d6_verification", "d7_prevention", "d8_closure"],
    },
}


def run_tool(db: Session, part_id: str, name: str, args: dict) -> dict:
    if name == "trend":
        return an.trend(db, part_id, args["defect_type"], args.get("days", 42))
    if name == "rate_by":
        return an.rate_by(db, part_id, args["dimension"], args["defect_type"], args.get("days", 42))
    if name == "rate_by_pair":
        return an.rate_by_pair(db, part_id, args["dim_a"], args["dim_b"], args["defect_type"], args.get("days", 42))
    if name == "defect_profile":
        return an.defect_profile(db, part_id, args["defect_type"], args.get("days", 42))
    raise ValueError(f"unknown tool {name}")


def _label(dim: str, key: str) -> str:
    return an.SHIFT_NAMES.get(key, key) if dim == "shift" else key


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


async def investigate(db: Session, part: Part, defect_type: str, days: int = 42) -> AsyncIterator[dict]:
    if settings.use_meta:
        try:
            async for ev in _spark_agent(db, part, defect_type, days):
                yield ev
            return
        except Exception as e:
            log.warning("Muse Spark agent failed, using offline analyst: %s", e)
            yield {"type": "warning", "text": f"Muse Spark unavailable ({type(e).__name__}); continuing with the offline analyst."}
    async for ev in _offline_agent(db, part, defect_type, days):
        yield ev


# ---------------------------------------------------------------- offline analyst

async def _offline_agent(db: Session, part: Part, dt: str, days: int) -> AsyncIterator[dict]:
    pid = part.id
    evidence: list[dict] = []

    async def call(name: str, args: dict, why: str):
        yield {"type": "thought", "text": why}
        yield {"type": "tool_call", "tool": name, "args": args}
        res = run_tool(db, pid, name, args)
        yield {"type": "tool_result", "tool": name, "args": args, "result": res}
        evidence.append({"tool": name, "args": args, "result": res})

    async for ev in call("trend", {"defect_type": dt, "days": days},
                         f"First I need to size the problem: how often does {dt} show up on {part.name}, and is it getting worse?"):
        yield ev
    s = evidence[-1]["result"]["series"]
    if not s or sum(x["defective"] for x in s) == 0:
        yield {"type": "finding", "text": f"No {dt} recorded on {part.id} in the last {days} days - nothing to investigate.", "strength": "info"}
        yield {"type": "done"}
        return
    first, last = s[0]["rate"], s[-1]["rate"]
    peak = max(s, key=lambda x: x["rate"])
    direction = "rising" if last > first * 1.25 else "falling" if last < first * 0.8 else "roughly flat"
    yield {"type": "finding", "strength": "info",
           "text": f"{dt.capitalize()} rate is {direction}: {_pct(first)} in the week of {s[0]['period_start']} vs {_pct(last)} last week (peak {_pct(peak['rate'])}, week of {peak['period_start']})."}

    async for ev in call("defect_profile", {"defect_type": dt, "days": days},
                         "Where on the casting does it appear, and how big? That tells me whether it's a process or a design issue."):
        yield ev
    prof = evidence[-1]["result"]
    zones = ", ".join(f"{k} {v}" for k, v in list(prof["zones"].items())[:3])
    yield {"type": "finding", "strength": "info",
           "text": f"{prof['count']} {dt} defects ({prof['critical']} critical). Location: {zones}. Median size {prof['size_mm']['p50']} mm, 90th percentile {prof['size_mm']['p90']} mm."}

    singles = []
    for dim in ("machine", "shift", "supplier"):
        async for ev in call("rate_by", {"dimension": dim, "defect_type": dt, "days": days},
                             f"Does the {dt} rate differ by {dim}?"):
            yield ev
        res = evidence[-1]["result"]
        top = res["rows"][0]
        singles.append((dim, top, res["overall_rate"]))
        strong = top["lift"] >= 1.3 and top["z"] >= 3
        yield {"type": "finding", "strength": "strong" if strong else "weak",
               "text": (f"{_label(dim, top['key'])} runs at {_pct(top['rate'])} vs {_pct(res['overall_rate'])} overall "
                        f"({top['lift']}x, z={top['z']}) and accounts for {_pct(top['share'])} of {dt} defects.")
               if strong else f"No meaningful difference by {dim} (top: {_label(dim, top['key'])} at {top['lift']}x)."}

    ranked = sorted(singles, key=lambda t: -t[1]["z"])
    sig = [t for t in ranked if t[1]["lift"] >= 1.2 and t[1]["z"] >= 3] or ranked[:2]
    if len(sig) < 2:
        sig = ranked[:2]
    best = None
    for i in range(len(sig)):
        for j in range(i + 1, len(sig)):
            a, b = sig[i][0], sig[j][0]
            async for ev in call("rate_by_pair", {"dim_a": a, "dim_b": b, "defect_type": dt, "days": days},
                                 f"{a.capitalize()} and {b} both stand out. Do they interact - is it one specific {a} x {b} combination?"):
                yield ev
            res = evidence[-1]["result"]
            c = res["cells"][0]
            yield {"type": "finding", "strength": "strong" if c["lift"] >= 2 and c["z"] >= 4 else "weak",
                   "text": f"Worst {a} x {b} cell: {_label(a, c['a'])} + {_label(b, c['b'])} at {_pct(c['rate'])} ({c['lift']}x, z={c['z']}), {_pct(c['share'])} of {dt} defects."}
            if best is None or c["lift"] > best[0]["lift"]:
                best = (c, (a, b), res["overall_rate"])
    cell, (d1, d2), _ = best
    interaction = cell["lift"] >= 2 and cell["z"] >= 4
    if interaction:
        yield {"type": "finding", "strength": "strong",
               "text": f"Hot spot: {_label(d1, cell['a'])} on {_label(d2, cell['b'])} - {_pct(cell['rate'])} {dt} rate, {cell['lift']}x the plant average, {_pct(cell['share'])} of all {dt} defects from one cell."}

    # a secondary contributor that is not part of the hot spot (e.g. a new supplier)
    secondary = None
    for dim, top, base in ranked:
        if interaction and dim in (d1, d2):
            continue
        if top["lift"] >= 1.25 and top["z"] >= 3:
            secondary = (dim, top, base)
            break
    if secondary:
        dim, top, _ = secondary
        async for ev in call("rate_by", {"dimension": dim, "defect_type": dt, "days": 21},
                             f"{_label(dim, top['key'])} also stands out independently. Checking the last 3 weeks to see if it's recent."):
            yield ev
        recent = evidence[-1]["result"]
        rt = next((r for r in recent["rows"] if r["key"] == top["key"]), None)
        if rt:
            yield {"type": "finding", "strength": "strong",
                   "text": f"Secondary contributor: {_label(dim, top['key'])} at {rt['lift']}x the rate over the last 3 weeks ({_pct(rt['rate'])} vs {_pct(recent['overall_rate'])})."}

    yield {"type": "thought", "text": "Enough evidence. Drafting the 8D report with containment, root cause and corrective actions."}
    report = _offline_report(part, dt, days, evidence, cell if interaction else None, (d1, d2), secondary, ranked)
    yield {"type": "report", "report": report}
    yield {"type": "done"}


def _offline_report(part, dt, days, evidence, cell, dims, secondary, ranked) -> dict:
    hints = CAUSE_HINTS.get(dt, CAUSE_HINTS["porosity"])
    trend = evidence[0]["result"]["series"]
    prof = evidence[1]["result"]
    today = datetime.now()
    causes, ev_lines = [], []
    if cell:
        a, b = _label(dims[0], cell["a"]), _label(dims[1], cell["b"])
        causes.append(f"{hints[dims[0]].format(v=a)}, made worse by {hints[dims[1]].format(v=b)}")
        ev_lines.append(f"{a} x {b}: {_pct(cell['rate'])} {dt} rate vs {_pct(ranked[0][2])} plant average ({cell['lift']}x); {_pct(cell['share'])} of all {dt} defects.")
    elif ranked[0][1]["lift"] >= 1.2 and ranked[0][1]["z"] >= 3:
        dim, top, base = ranked[0]
        causes.append(hints[dim].format(v=_label(dim, top["key"])))
        ev_lines.append(f"{_label(dim, top['key'])}: {_pct(top['rate'])} vs {_pct(base)} overall ({top['lift']}x).")
    if secondary:
        dim, top, base = secondary
        causes.append(hints[dim].format(v=_label(dim, top["key"])))
        ev_lines.append(f"{_label(dim, top['key'])}: {top['lift']}x the {dt} rate (z={top['z']}).")
    if not causes:
        causes.append(f"common-cause variation - no machine, shift or supplier explains the {dt} rate "
                      f"(largest lift {ranked[0][1]['lift']}x), so look at tooling, pattern wear and the method itself")
        ev_lines.append("; ".join(f"{d}: max {t['lift']}x (z={t['z']})" for d, t, _ in ranked))
    ev_lines.append(f"Trend: {_pct(trend[0]['rate'])} -> {_pct(trend[-1]['rate'])} over {days} days; {prof['count']} defects, median {prof['size_mm']['p50']} mm.")
    focus = (f"{_label(dims[0], cell['a'])} / {_label(dims[1], cell['b'])}" if cell
             else _label(ranked[0][0], ranked[0][1]["key"]) if ranked[0][1]["lift"] >= 1.2 and ranked[0][1]["z"] >= 3 else "all lines")
    is_por = dt == "porosity"
    return {
        "title": f"8D - {dt.capitalize()} on {part.name} ({part.id})",
        "date": today.strftime("%d %b %Y"),
        "part": {"id": part.id, "name": part.name, "material": part.material},
        "defect_type": dt,
        "d1_team": ["Quality Engineer (lead)", "Melting Supervisor", "Night-shift Foreman" if cell and "C" in (cell["a"], cell["b"]) else "Production Supervisor",
                    "Purchase / Supplier Quality", "InspectAgent (data analysis)"],
        "d2_problem": (f"{prof['count']} {dt} defects on {part.name} in the last {days} days ({prof['critical']} critical). "
                       f"Rate moved from {_pct(trend[0]['rate'])} to {_pct(trend[-1]['rate'])}. Defects appear mainly in the "
                       f"{next(iter(prof['zones']), 'casting')} zone, median size {prof['size_mm']['p50']} mm. "
                       + (f"Concentrated on {focus}." if focus != "all lines" else "Spread evenly across furnaces, shifts and suppliers.")),
        "d3_containment": [
            f"100% InspectAgent inspection of all {part.id} castings from {focus} until closure.",
            "Quarantine WIP and finished stock from the last 5 heats of the affected cell; re-inspect hub and vanes.",
            "Notify dispatch: no shipment of affected heats without QE sign-off.",
        ],
        "d4_root_cause": {
            "statement": "Probable root cause: " + "; and ".join(causes) + ".",
            "evidence": ev_lines,
            "five_whys": ([
                f"Why are castings scrapped? Gas porosity > limit in hub/vanes.",
                "Why gas porosity? Dissolved hydrogen in the melt comes out of solution on solidification.",
                f"Why more hydrogen on {focus}? Degassing / ladle preheat not consistently done on that cell.",
                "Why not done consistently? No checklist enforcement or hydrogen check at the pouring station.",
                "Why no check? Melt-quality controls are not part of the shift handover standard.",
            ] if is_por else [
                f"Why are castings rejected? {dt.capitalize()} beyond acceptance limits.",
                f"Why {dt}? Process condition on {focus} drifts outside the window.",
                "Why does it drift? Parameter not monitored at the station.",
                "Why not monitored? No control plan entry for this characteristic.",
                "Why no control plan entry? Defect history was not analysed by cell until now.",
            ]),
        },
        "d5_corrective_actions": [
            {"action": ("Make degassing (N2 lance, 8 min) and ladle preheat > 600 C mandatory with sign-off on every heat; add a reduced-pressure test sample per heat."
                        if is_por else f"Define and lock the process window on {focus}; add to control plan."),
             "owner": "Melting Supervisor", "due": "7 days"},
            {"action": "Retrain the affected shift on melt handling and pouring temperature; add pouring temperature log (target 1380-1420 C)." if is_por
             else "Retrain the affected shift; add a first-off check.", "owner": "Production Supervisor", "due": "10 days"},
        ] + ([{"action": f"Raise supplier complaint (SCAR) with {secondary[1]['key']}; require mill certificates and moisture/rust-free charge material; incoming inspection on next 5 lots.",
               "owner": "Supplier Quality", "due": "14 days"}] if secondary and secondary[0] == "supplier" else []),
        "d6_verification": (f"Track the {dt} rate on {focus} with InspectAgent for 3 weeks; success when it is at or below the plant baseline "
                            f"of {_pct(ranked[0][2])} with no critical defects for 10 consecutive heats."),
        "d7_prevention": [
            "Add melt-quality checks (degassing, ladle preheat, pouring temperature) to the shift handover checklist." if is_por else "Add the characteristic to the control plan and PFMEA.",
            "InspectAgent alert when any machine x shift cell exceeds 2x the plant defect rate for 2 consecutive days.",
            "Update PFMEA and share the lesson with the other furnaces / lines.",
        ],
        "d8_closure": "Close after verification data confirms the fix; recognise the team and archive this 8D with the InspectAgent evidence.",
        "charts": {"trend": trend, "by": {dim: next((e["result"] for e in evidence if e["tool"] == "rate_by" and e["args"]["dimension"] == dim), None) for dim, _, _ in ranked}},
    }


# ---------------------------------------------------------------- Muse Spark agent

AGENT_SYSTEM = """You are InspectAgent's root-cause analyst for a foundry. Investigate why a defect keeps recurring
on a part using the tools (they query real production and inspection history: machine = melt furnace, shift A/B/C
where C is night, supplier = pig iron / scrap supplier, batch = heat number).
Work like a quality engineer: size the problem, locate it on the part, slice by each dimension, then check
interactions between the strongest dimensions. Prefer effects with large lift AND high z-score (>3).
Before each tool call, write one short sentence of reasoning. After each result, state one concrete finding with numbers.
Stop after at most 8 tool calls. Then reply with exactly: READY."""


def _tool_finding(name: str, args: dict, res: dict, dt: str) -> dict | None:
    """Key findings come from the numbers a tool returned (same thresholds as the offline analyst),
    not from parsing the model's prose."""
    if "error" in res:
        return None
    if name == "rate_by" and res.get("rows"):
        dim, top = args.get("dimension", ""), res["rows"][0]
        if top["lift"] >= 1.3 and top["z"] >= 3:
            return {"type": "finding", "strength": "strong",
                    "text": f"{_label(dim, top['key'])} runs at {_pct(top['rate'])} vs {_pct(res['overall_rate'])} overall "
                            f"({top['lift']}x, z={top['z']}) and accounts for {_pct(top['share'])} of {dt} defects."}
    if name == "rate_by_pair" and res.get("cells"):
        a, b, c = args.get("dim_a", ""), args.get("dim_b", ""), res["cells"][0]
        if c["lift"] >= 2 and c["z"] >= 4:
            return {"type": "finding", "strength": "strong",
                    "text": f"Hot spot: {_label(a, c['a'])} on {_label(b, c['b'])} - {_pct(c['rate'])} {dt} rate, "
                            f"{c['lift']}x the plant average, {_pct(c['share'])} of all {dt} defects from one cell."}
    return None


async def _spark_agent(db: Session, part: Part, dt: str, days: int) -> AsyncIterator[dict]:
    client = MetaClient()
    evidence: list[dict] = []
    messages: list[dict] = [
        {"role": "system", "content": AGENT_SYSTEM},
        {"role": "user", "content": f"Part {part.id} ({part.name}, {part.material}). Investigate recurring '{dt}' over the last {days} days."},
    ]
    for _ in range(10):
        msg = await client.chat(messages, tools=TOOLS)
        text = (msg.get("content") or "").strip() if isinstance(msg.get("content"), (str, type(None))) else ""
        calls = msg.get("tool_calls") or []
        if text and text != "READY":
            yield {"type": "thought" if calls else "finding", "text": text, "strength": "strong"}
        messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")} | {"role": "assistant"})
        if not calls:
            break
        for c in calls:
            name = c["function"]["name"]
            args = json.loads(c["function"].get("arguments") or "{}")
            yield {"type": "tool_call", "tool": name, "args": args}
            try:
                res = run_tool(db, part.id, name, args)
            except Exception as e:
                res = {"error": str(e)}
            evidence.append({"tool": name, "args": args, "result": res})
            yield {"type": "tool_result", "tool": name, "args": args, "result": res}
            if (finding := _tool_finding(name, args, res, dt)) is not None:
                yield finding
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(res)})
    yield {"type": "thought", "text": "Drafting the 8D report from the evidence."}
    messages.append({"role": "user", "content": "Now write the 8D/CAPA report as JSON. Evidence lines must quote the numbers you found. "
                                                "Corrective actions must be specific to foundry practice with owner roles and due dates in days."})
    report = await client.chat_json(messages, REPORT_SCHEMA)
    trend = next((e["result"] for e in evidence if e["tool"] == "trend"), an.trend(db, part.id, dt, days))
    report.update(date=datetime.now().strftime("%d %b %Y"), defect_type=dt,
                  part={"id": part.id, "name": part.name, "material": part.material},
                  charts={"trend": trend["series"], "by": {e["args"]["dimension"]: e["result"] for e in evidence
                                                          if e["tool"] == "rate_by" and "dimension" in e["args"]}})
    yield {"type": "report", "report": report}
    yield {"type": "done"}
