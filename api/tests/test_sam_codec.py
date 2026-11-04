"""SAM 3.1 wire-format decoding (port of @meta-sam/parser)."""
import numpy as np

from app.providers import sam_codec as sc

# lossless samples published in the @meta-sam/parser README (a 320x334 clip, prompt "button")
README_LINE = (
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>"
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>"
    ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>"
    "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>"
)


def _pack(data: bytes) -> str:
    n, prefix = len(data), []
    for _ in range(sc.PREFIX):
        prefix.append(sc.ALPHABET[n % 85])
        n //= 85
    out = prefix[::-1]
    full = len(data) - len(data) % 4
    for i in range(0, full, 4):
        v = int.from_bytes(data[i:i + 4], "big")
        digits = []
        for _ in range(5):
            digits.append(v % 85)
            v //= 85
        out += [sc.ALPHABET[d] for d in digits[::-1]]
    rem = len(data) - full
    if rem:
        v = int.from_bytes(data[full:] + bytes(4 - rem), "big")
        digits = []
        for _ in range(5):
            digits.append(v % 85)
            v //= 85
        out += [sc.ALPHABET[d] for d in digits[::-1][: rem + 1]]
    return "".join(out)


class _Encoder:  # port of RangeEncoder
    def __init__(self):
        self.low, self.range, self.out = 0, sc.MASK32, bytearray()

    def encode(self, cum, freq, total):
        scaled = self.range // total
        self.low = (self.low + scaled * cum) & sc.MASK32
        self.range = scaled * freq
        while True:
            if ((self.low ^ (self.low + self.range)) & sc.MASK32) < sc.TOP:
                pass
            elif self.range < sc.BOTTOM:
                self.range = (-self.low) & sc.MASK32 & (sc.BOTTOM - 1)
            else:
                break
            self.out.append((self.low >> 24) & 0xFF)
            self.low = (self.low << 8) & sc.MASK32
            self.range = (self.range << 8) & sc.MASK32

    def finish(self):
        for _ in range(4):
            self.out.append((self.low >> 24) & 0xFF)
            self.low = (self.low << 8) & sc.MASK32
        return bytes(self.out)


def encode_one_bit(raster: np.ndarray) -> str:
    h, w = raster.shape
    enc, counts = _Encoder(), [1] * 8192
    pw = w + 4
    p = bytearray(pw * (h + 2))
    for y in range(h):
        for x in range(w):
            pos = (y + 2) * pw + 2 + x
            pr, er = pos - pw, pos - 2 * pw
            ctx = (p[pos - 1] | p[pos - 2] << 1 | p[pr - 2] << 2 | p[pr - 1] << 3 | p[pr] << 4 | p[pr + 1] << 5
                   | p[pr + 2] << 6 | p[er - 2] << 7 | p[er - 1] << 8 | p[er] << 9 | p[er + 1] << 10 | p[er + 2] << 11)
            o = ctx << 1
            z, one = counts[o], counts[o + 1]
            bit = int(raster[y, x])
            enc.encode(0, z, z + one) if bit == 0 else enc.encode(z, one, z + one)
            p[pos] = bit
            counts[o + bit] += 14
            if counts[o] + counts[o + 1] >= 4096:
                counts[o] = counts[o] >> 1 or 1
                counts[o + 1] = counts[o + 1] >> 1 or 1
    return "!" + _pack(enc.finish())


def test_one_bit_round_trip():
    rng = np.random.default_rng(3)
    for h, w in [(30, 41), (64, 17), (5, 5)]:
        yy, xx = np.mgrid[0:h, 0:w]
        r = (((xx - w / 2) ** 2 / (w * w / 6) + (yy - h / 2) ** 2 / (h * h / 5)) < 1).astype(np.uint8)
        r |= (rng.random((h, w)) < 0.03).astype(np.uint8)
        assert (sc.decode_mask(encode_one_bit(r), w, h) == r).all()


def test_readme_line_parses_and_decodes():
    recs = sc.parse_output(README_LINE)
    assert [r.object_id for r in recs] == [0, 1]
    a = recs[0]
    assert (a.x1, a.y1, a.x2, a.y2, a.img_w, a.img_h, a.mask_h, a.mask_w) == (211, 228, 270, 254, 320, 334, 27, 60)
    full = a.full_mask()
    assert full.shape == (334, 320)
    ys, xs = np.nonzero(full)
    assert xs.min() >= 211 and xs.max() <= 270 and ys.min() >= 228 and ys.max() <= 254
    # a button: filled interior, rounded (empty) corners
    local = sc.decode_mask(a.payload, 60, 27)
    assert local.mean() > 0.85 and local[13, 30] == 1 and local[0, 0] == 0


def test_rejects_garbage():
    import pytest

    with pytest.raises(sc.MaskDecodeError):
        sc.decode_mask("!abc", 4, 4)
