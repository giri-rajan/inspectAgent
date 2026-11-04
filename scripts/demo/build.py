"""Edit the recorded takes into the demo video.

    python3 scripts/demo/build.py            silent master + timing sheet (demo/out/silent.mp4, timing.md)
    python3 scripts/demo/build.py --voice    mix narration from demo/voice/<scene>.(m4a|wav|mp3|aiff),
                                             or one take in demo/voice/full.*, into inspectagent-demo.mp4

Model waits marked fast:<k>:start / fast:end are sped up k times (the on-screen timer says so).
With --voice, a scene whose narration runs longer than its picture holds its last frame.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "demo/out"
VOICE = Path(os.environ.get("VOICE_DIR", ROOT / "demo/voice"))
FPS = 30
XFADE = 0.4

# (scene, take, from mark, to mark, group). Scenes in one group play continuously; groups crossfade.
SCENES = [
    ("S1a", "cards", "card:title", "card:problem", "intro"),
    ("S1b", "cards", "card:problem", "card:arch", "intro"),
    ("S2", "inspect", "scene:S2", "scene:S3", "inspect"),
    ("S3", "inspect", "scene:S3", "scene:S4", "inspect"),
    ("S4", "inspect", "scene:S4", "scene:S4b", "inspect"),
    ("S4b", "inspect", "scene:S4b", "end", "inspect"),
    ("S5", "insights", "scene:S5", "scene:S6", "insights"),
    ("S6", "insights", "scene:S6", "end", "insights"),
    ("S7", "rules", "scene:S7", "end", "rules"),
    ("S8", "line", "scene:S8", "end", "line"),
    ("S9", "cards", "card:arch", "card:close", "outro"),
    ("S10", "cards", "card:close", "end", "outro"),
]


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def probe(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def raw_take(name: str) -> tuple[Path, dict, float]:
    """Frames at their real timestamps -> constant 30 fps 1080p video. Returns (video, marks, t0)."""
    d = json.loads((OUT / "takes" / name / "take.json").read_text())
    frames, marks = d["frames"], {m["label"]: m["t"] for m in d["marks"]}
    t0 = frames[0]["t"]
    end = marks["end"]
    lst = OUT / "takes" / name / "frames.ffconcat"
    lines = ["ffconcat version 1.0"]
    for i, f in enumerate(frames):
        nxt = frames[i + 1]["t"] if i + 1 < len(frames) else end
        lines += [f"file '{f['file']}'", f"duration {max(0.001, nxt - f['t']):.4f}"]
    lines.append(f"file '{frames[-1]['file']}'")
    lst.write_text("\n".join(lines) + "\n")
    video = OUT / "takes" / name / "raw.mp4"
    if not video.exists() or video.stat().st_mtime < (OUT / "takes" / name / "take.json").stat().st_mtime:
        ff("-f", "concat", "-safe", "0", "-i", str(lst), "-vf",
           f"fps={FPS},scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "15", "-preset", "medium", str(video))
    return video, d["marks"], t0


def segments(marks: list[dict], t0: float, a: str, b: str) -> list[tuple[float, float, float]]:
    """[(start, end, speed)] in take seconds between marks a and b, split at fast marks."""
    by = {m["label"]: m["t"] for m in marks}
    start, stop = by[a] - t0, by[b] - t0
    cuts, speed, out, cur = [], 1.0, [], start
    for m in marks:
        t = m["t"] - t0
        if not (start < t < stop):
            continue
        if m["label"].startswith("fast:") and m["label"] != "fast:end":
            cuts.append((t, float(m["label"].split(":")[1])))
        elif m["label"] == "fast:end":
            cuts.append((t, 1.0))
    for t, nxt in cuts:
        if t > cur:
            out.append((cur, t, speed))
        cur, speed = t, nxt
    out.append((cur, stop, speed))
    return [s for s in out if s[1] - s[0] > 0.05]


def voice_file(scene: str) -> Path | None:
    for ext in ("m4a", "wav", "mp3", "aiff", "aac"):
        p = VOICE / f"{scene}.{ext}"
        if p.exists():
            return p
    return None


def build_scene(scene: str, take: Path, segs: list, hold: float) -> Path:
    parts, labels = [], []
    for i, (a, b, k) in enumerate(segs):
        parts.append(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{k}[s{i}]")
        labels.append(f"[s{i}]")
    graph = ";".join(parts) + f";{''.join(labels)}concat=n={len(labels)}:v=1:a=0,fps={FPS}"
    if hold > 0:
        graph += f",tpad=stop_mode=clone:stop_duration={hold:.3f}"
    graph += "[v]"
    out = OUT / "scenes" / f"{scene}.mp4"
    out.parent.mkdir(exist_ok=True)
    ff("-i", str(take), "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "16", "-preset", "medium",
       "-pix_fmt", "yuv420p", str(out))
    return out


def main(with_voice: bool) -> None:
    takes = {}
    for name in dict.fromkeys(t for _, t, *_ in SCENES):
        takes[name] = raw_take(name)

    full_voice = next((p for p in (VOICE / f"full.{e}" for e in ("m4a", "wav", "mp3", "aiff")) if p.exists()), None) if with_voice else None
    rows, groups = [], {}
    for scene, take, a, b, group in SCENES:
        video, marks, t0 = takes[take]
        segs = segments(marks, t0, a, b)
        length = sum((e - s) / k for s, e, k in segs)
        vf = voice_file(scene) if with_voice and not full_voice else None
        vlen = probe(vf) + 0.3 if vf else 0.0
        hold = max(0.0, vlen - length)
        path = build_scene(scene, video, segs, hold)
        rows.append({"scene": scene, "group": group, "picture": round(length, 2), "voice": round(vlen, 2), "file": path, "vf": vf})
        groups.setdefault(group, []).append(path)

    # join scenes inside each group, then crossfade the groups
    gfiles = []
    for g, files in groups.items():
        lst = OUT / "scenes" / f"{g}.txt"
        lst.write_text("".join(f"file '{f.name}'\n" for f in files))
        gf = OUT / "scenes" / f"group_{g}.mp4"
        ff("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(gf))
        gfiles.append((g, gf, probe(gf)))

    inputs, graph, offset, prev = [], [], 0.0, "[0:v]"
    starts = {}
    for i, (g, gf, dur) in enumerate(gfiles):
        inputs += ["-i", str(gf)]
        starts[g] = offset if i == 0 else offset - XFADE
        if i > 0:
            offset -= XFADE
            graph.append(f"{prev}[{i}:v]xfade=transition=fade:duration={XFADE}:offset={offset:.3f}[x{i}]")
            prev = f"[x{i}]"
        offset += dur
    total = offset
    silent = OUT / ("picture.mp4" if with_voice else "silent.mp4")
    if graph:
        ff(*inputs, "-filter_complex", ";".join(graph), "-map", prev, "-c:v", "libx264", "-crf", "17", "-preset", "slow",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(silent))
    else:
        ff(*inputs, "-c", "copy", str(silent))

    # timing sheet: where each scene starts in the final cut
    t, cur_group, sheet = 0.0, None, []
    for r in rows:
        if r["group"] != cur_group:
            t = starts[r["group"]]
            cur_group = r["group"]
        r["start"] = t
        length = max(r["picture"], r["voice"])
        sheet.append(f"| {r['scene']} | {fmt(t)} | {length:5.1f} s | {r['picture']:5.1f} s |" + (f" {r['voice']:4.1f} s |" if with_voice else ""))
        t += length
    head = "| Scene | Starts | Length | Picture |" + (" Voice |" if with_voice else "")
    (OUT / "timing.md").write_text(f"Total {fmt(total)}\n\n{head}\n|---|---|---|---|{'---|' if with_voice else ''}\n" + "\n".join(sheet) + "\n")
    print((OUT / "timing.md").read_text())

    thumb = OUT / "thumbnail.jpg"
    s2 = next(r for r in rows if r["scene"] == "S2")
    ff("-ss", f"{s2['start'] + s2['picture'] - 1.0:.2f}", "-i", str(silent), "-frames:v", "1", "-q:v", "2", str(thumb))

    if not with_voice:
        print(f"silent master: {silent}")
        return

    final = OUT / os.environ.get("FINAL_NAME", "inspectagent-demo.mp4")
    vdur = probe(silent)
    if full_voice:
        ff("-i", str(silent), "-i", str(full_voice), "-filter_complex",
           f"[1:a]highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur={vdur:.3f},atrim=0:{vdur:.3f}[a]", "-map", "0:v", "-map", "[a]",
           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final))
    else:
        ins, chains, mix = ["-i", str(silent)], [], []
        voiced = [r for r in rows if r["vf"]]
        for i, r in enumerate(voiced, start=1):
            ins += ["-i", str(r["vf"])]
            ms = int((r["start"] + 0.15) * 1000)
            chains.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,highpass=f=80,afftdn=nf=-25,adelay={ms}|{ms}[a{i}]")
            mix.append(f"[a{i}]")
        graph = ";".join(chains) + f";{''.join(mix)}amix=inputs={len(mix)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur={vdur:.3f},atrim=0:{vdur:.3f}[a]"
        ff(*ins, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
           "-movflags", "+faststart", str(final))
    print(f"final: {final}  ({fmt(probe(final))})")


def fmt(s: float) -> str:
    t = round(s, 1)
    return f"{int(t // 60)}:{t % 60:04.1f}"


if __name__ == "__main__":
    main("--voice" in sys.argv)
