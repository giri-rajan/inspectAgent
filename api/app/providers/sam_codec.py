"""Python port of Meta's SAM 3.1 wire format (@meta-sam/parser mask-codec.js).

A SAM response line looks like:
    <0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|><|mask;x=0;y=0;data=H,W,~payload|>,1<|box...
The mask raster is H x W, row-major, and covers the record's box (x2/y2 inclusive).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

_EXCLUDED = set('"\\,;<>|')
ALPHABET = "".join(chr(c) for c in range(0x21, 0x7F) if chr(c) not in _EXCLUDED)
_VALUES = {ch: i for i, ch in enumerate(ALPHABET)}
RADIX = 85
PREFIX = 5
MASK32 = 0xFFFFFFFF
TOP = 1 << 24
BOTTOM = 1 << 16

FRAME_RE = re.compile(r"<(\d+)f>")
NUM = r"\d+(?:\.\d+)?"
RECORD_RE = re.compile(
    r"(?:^|,)(?P<id>\d+)"
    r"<\|box;x1=(?P<x1>\d+);y1=(?P<y1>\d+);x2=(?P<x2>\d+);y2=(?P<y2>\d+);"
    r"w=(?P<w>\d+);h=(?P<h>\d+)(?:;c=(?P<bc>" + NUM + r"))?\|>"
    r"<\|mask;x=0;y=0(?:;c=(?P<mc>" + NUM + r"))?;"
    r"data=(?P<H>\d+),(?P<W>\d+),(?P<payload>[~!][^|]*)\|>"
)


class MaskDecodeError(ValueError):
    pass


@dataclass
class SamRecord:
    frame: int
    object_id: int
    x1: int
    y1: int
    x2: int  # inclusive
    y2: int  # inclusive
    img_w: int
    img_h: int
    confidence: float | None
    mask_h: int
    mask_w: int
    payload: str

    def full_mask(self) -> np.ndarray:
        """Decode and paste the box-local raster into a full-frame uint8 mask."""
        import cv2

        local = decode_mask(self.payload, self.mask_w, self.mask_h)
        bw, bh = self.x2 - self.x1 + 1, self.y2 - self.y1 + 1
        if local.shape != (bh, bw):
            local = cv2.resize(local, (bw, bh), interpolation=cv2.INTER_NEAREST)
        full = np.zeros((self.img_h, self.img_w), np.uint8)
        full[self.y1 : self.y1 + bh, self.x1 : self.x1 + bw] = local[: self.img_h - self.y1, : self.img_w - self.x1]
        return full


def parse_output(text: str) -> list[SamRecord]:
    records: list[SamRecord] = []
    for line in text.strip().splitlines():
        m = FRAME_RE.match(line)
        if not m:
            continue
        frame = int(m.group(1))
        for r in RECORD_RE.finditer(line[m.end():]):
            conf = r["mc"] or r["bc"]
            records.append(SamRecord(
                frame=frame, object_id=int(r["id"]),
                x1=int(r["x1"]), y1=int(r["y1"]), x2=int(r["x2"]), y2=int(r["y2"]),
                img_w=int(r["w"]), img_h=int(r["h"]),
                confidence=float(conf) if conf else None,
                mask_h=int(r["H"]), mask_w=int(r["W"]), payload=r["payload"],
            ))
    return records


# ---------------------------------------------------------------- base85 packing

def _digit(ch: str) -> int:
    v = _VALUES.get(ch, -1)
    if v < 0:
        raise MaskDecodeError("Mask payload contains an invalid character.")
    return v


def unpack(payload: str) -> bytes:
    if len(payload) < PREFIX:
        raise MaskDecodeError("Mask payload is missing its length prefix.")
    length = 0
    for ch in payload[:PREFIX]:
        length = length * RADIX + _digit(ch)
    rem = length % 4
    expected = PREFIX + (length // 4) * 5 + (rem + 1 if rem else 0)
    if len(payload) != expected:
        raise MaskDecodeError("Mask payload length does not match its prefix.")
    out = bytearray(length)
    src, dst, full = PREFIX, 0, length - rem
    while dst < full:
        v = 0
        for i in range(5):
            v = v * RADIX + _digit(payload[src + i])
        src += 5
        out[dst : dst + 4] = (v & MASK32).to_bytes(4, "big")
        dst += 4
    if rem:
        v = 0
        for i in range(5):
            v = v * RADIX + (_digit(payload[src + i]) if i < rem + 1 else RADIX - 1)
        for i in range(rem):
            out[dst + i] = (v >> (24 - i * 8)) & 0xFF
    return bytes(out)


# ---------------------------------------------------------------- range decoder

class _RangeDecoder:
    def __init__(self, data: bytes):
        if len(data) < 4:
            raise MaskDecodeError("Mask payload is missing its finalization.")
        self.data, self.pos = data, 0
        self.low, self.range, self.code, self.scaled = 0, MASK32, 0, 0
        for _ in range(4):
            self.code = ((self.code << 8) | self._read()) & MASK32

    def _read(self) -> int:
        if self.pos >= len(self.data):
            raise MaskDecodeError("Mask payload ended before decoding completed.")
        b = self.data[self.pos]
        self.pos += 1
        return b

    def freq(self, total: int) -> int:
        self.scaled = self.range // total
        if self.scaled == 0:
            raise MaskDecodeError("Mask payload has invalid coding state.")
        v = ((self.code - self.low) & MASK32) // self.scaled
        return total - 1 if v >= total else v

    def decode(self, cum: int, freq: int) -> None:
        self.low = (self.low + self.scaled * cum) & MASK32
        self.range = self.scaled * freq
        while True:
            if ((self.low ^ (self.low + self.range)) & MASK32) < TOP:
                pass
            elif self.range < BOTTOM:
                self.range = (-self.low) & MASK32 & (BOTTOM - 1)
            else:
                break
            self.code = ((self.code << 8) | self._read()) & MASK32
            self.low = (self.low << 8) & MASK32
            self.range = (self.range << 8) & MASK32


# ---------------------------------------------------------------- one_bit ("!")

_PAD = 2


def _decode_one_bit(payload: str, width: int, height: int) -> np.ndarray:
    dec = _RangeDecoder(unpack(payload[1:]))
    counts = [1] * ((1 << 12) * 2)
    pw = width + 2 * _PAD
    p = bytearray(pw * (height + _PAD))
    out = np.zeros(width * height, np.uint8)
    for y in range(height):
        row = (y + _PAD) * pw + _PAD
        for x in range(width):
            pos = row + x
            pr, er = pos - pw, pos - 2 * pw
            ctx = (p[pos - 1] | p[pos - 2] << 1 | p[pr - 2] << 2 | p[pr - 1] << 3 | p[pr] << 4
                   | p[pr + 1] << 5 | p[pr + 2] << 6 | p[er - 2] << 7 | p[er - 1] << 8
                   | p[er] << 9 | p[er + 1] << 10 | p[er + 2] << 11)
            o = ctx << 1
            zero, one = counts[o], counts[o + 1]
            bit = 0 if dec.freq(zero + one) < zero else 1
            dec.decode(0, zero) if bit == 0 else dec.decode(zero, one)
            p[pos] = bit
            out[y * width + x] = bit
            counts[o + bit] += 14
            if counts[o] + counts[o + 1] >= 4096:
                counts[o] = counts[o] >> 1 or 1
                counts[o + 1] = counts[o + 1] >> 1 or 1
    return out.reshape(height, width)


# ---------------------------------------------------------------- lossless ("~")

def _paeth(a: int, b: int, c: int) -> int:
    e = a + b - c
    da, db, dc = abs(e - a), abs(e - b), abs(e - c)
    if da <= db and da <= dc:
        return a
    return b if db <= dc else c


def _predict(out, off, x, y, mode, w) -> int:
    if not 0 <= mode < 5:
        raise MaskDecodeError("Lossless mask payload uses an invalid predictor.")
    left = out[off - 1] if x > 0 else 0
    up = out[off - w] if y > 0 else 0
    if mode == 1:
        return up
    if mode == 2:
        return left
    if mode == 3:
        return (left + up) >> 1
    ul = out[off - w - 1] if x > 0 and y > 0 else 0
    if mode == 0:
        return _paeth(left, up, ul)
    if ul >= max(left, up):
        return min(left, up)
    if ul <= min(left, up):
        return max(left, up)
    return left + up - ul


def _decode_lossless(payload: str, width: int, height: int) -> np.ndarray:
    packed = unpack(payload[1:])
    if len(packed) < 5:
        raise MaskDecodeError("Lossless mask payload is truncated.")
    selector = packed[0]
    dec = _RangeDecoder(packed[1:])
    n = width * height
    out = [0] * n
    res = [0] * n
    zc = [1] * 32
    o1 = [1] * (256 * 256)
    o1t = [256] * 256
    o0 = [2] * 256
    o0t = 512
    o2: dict[int, list[int]] = {}
    prev = 0
    for off in range(n):
        x, y = off % width, off // width
        ctx = ((1 if x == 0 else int(res[off - 1] == 0))
               | (1 if y == 0 else int(res[off - width] == 0)) << 1
               | (1 if not (x > 0 and y > 0) else int(res[off - width - 1] == 0)) << 2
               | (1 if not (y > 0 and x < width - 1) else int(res[off - width + 1] == 0)) << 3)
        zo = ctx << 1
        z, nz = zc[zo], zc[zo + 1]
        bit = 0 if dec.freq(z + nz) < z else 1
        dec.decode(0, z) if bit == 0 else dec.decode(z, nz)
        zc[zo + bit] += 32
        if zc[zo] + zc[zo + 1] >= 16384:
            zc[zo] = zc[zo] >> 1 or 1
            zc[zo + 1] = zc[zo + 1] >> 1 or 1
        sym = 0
        if bit:
            above = res[off - width] if off >= width else 0
            key = (prev << 8) | above
            second = o2.get(key)
            if second is None:
                second = o2[key] = [0] * 257
            fo = prev << 8
            excl = second[0] + o1[fo] + o0[0]
            total = second[256] + o1t[prev] + o0t - excl
            target = dec.freq(total)
            cum, sym = 0, 1
            f = second[1] + o1[fo + 1] + o0[1]
            while cum + f <= target:
                cum += f
                sym += 1
                if sym >= 256:
                    raise MaskDecodeError("Lossless mask payload is malformed.")
                f = second[sym] + o1[fo + sym] + o0[sym]
            dec.decode(cum, f)
            second[sym] += 616
            second[256] += 616
            if second[256] >= 50176:
                for v in range(256):
                    second[v] >>= 1
                second[256] = sum(second[:256])
            o1[fo + sym] += 56
            o1t[prev] += 56
            if o1t[prev] >= 8192:
                t = 0
                for v in range(256):
                    o1[fo + v] = o1[fo + v] >> 1 or 1
                    t += o1[fo + v]
                o1t[prev] = t
            o0[sym] += 32
            o0t += 32
            if o0t >= 4096:
                for v in range(256):
                    o0[v] >>= 1
                o0t = sum(o0)
        res[off] = sym
        delta = -((sym + 1) >> 1) if sym & 1 else sym >> 1
        out[off] = (_predict(out, off, x, y, selector, width) + delta) & 0xFF
        prev = sym
    return (np.array(out, np.uint8).reshape(height, width) >= 129).astype(np.uint8)


def decode_mask(payload: str, width: int, height: int) -> np.ndarray:
    """Return a (height, width) uint8 raster of 0/1."""
    if payload.startswith("!"):
        return _decode_one_bit(payload, width, height)
    if payload.startswith("~"):
        return _decode_lossless(payload, width, height)
    raise MaskDecodeError("Unknown mask encoding marker.")
