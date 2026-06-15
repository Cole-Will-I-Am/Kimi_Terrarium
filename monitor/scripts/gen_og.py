#!/usr/bin/env python3
"""Render the social share card (Open Graph image) for the Terrarium, 1200x630.
SEER-branded, dependency-light (Pillow + DejaVu fonts). Re-run to regenerate."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.normpath(os.path.join(HERE, "..", "public"))
W, H = 1200, 630
BG = (6, 6, 8)
ACCENT = (97, 121, 255)
ACCENT2 = (140, 97, 242)
SUCCESS = (61, 219, 143)
WHITE = (246, 247, 251)
GRAY = (165, 171, 192)
DIM = (112, 116, 134)
F = "/usr/share/fonts/truetype/dejavu/"
def font(name, size): return ImageFont.truetype(F + name, size)

base = Image.new("RGB", (W, H), BG)

# soft ambient glows (blurred ellipses) — the SEER aurora
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([-160, -260, 520, 360], fill=ACCENT + (90,))
gd.ellipse([760, -300, 1400, 320], fill=ACCENT2 + (80,))
gd.ellipse([350, 470, 950, 900], fill=SUCCESS + (28,))
glow = glow.filter(ImageFilter.GaussianBlur(150))
base = Image.alpha_composite(base.convert("RGBA"), glow).convert("RGB")
d = ImageDraw.Draw(base)

# top hairline gradient
for x in range(W):
    t = x / W
    c = tuple(int(ACCENT[i] + (ACCENT2[i] - ACCENT[i]) * t) for i in range(3))
    d.line([(x, 0), (x, 4)], fill=c)

def tracked(text, fnt, y, fill, tracking=0, cx=W // 2):
    widths = [d.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, widths):
        d.text((x, y), ch, font=fnt, fill=fill)
        x += w + tracking
    return total

def centered(text, fnt, y, fill, cx=W // 2):
    w = d.textlength(text, font=fnt)
    d.text((cx - w / 2, y), text, font=fnt, fill=fill)
    return w

# emblem, centered near top
try:
    em = Image.open(os.path.join(PUB, "seer-emblem.png")).convert("RGBA")
    em = em.resize((96, 96), Image.LANCZOS)
    base.paste(em, (W // 2 - 48, 96), em)
except OSError:
    pass

# title with letter tracking (wordmark feel)
tracked("THE  TERRARIUM", font("DejaVuSans-Bold.ttf", 86), 232, WHITE, tracking=6)

# gradient divider under the title
dy = 348
dw = 360
for i in range(dw):
    t = i / dw
    c = tuple(int(ACCENT[j] + (ACCENT2[j] - ACCENT[j]) * t) for j in range(3))
    d.line([(W // 2 - dw // 2 + i, dy), (W // 2 - dw // 2 + i, dy + 3)], fill=c)

# tagline
centered("an autonomous mind — given a room, a clock, and no agenda.",
         font("DejaVuSans.ttf", 31), 382, GRAY)
centered("ten minutes at a time, it does as it wishes. watch what it makes.",
         font("DejaVuSans.ttf", 25), 432, DIM)

# footer: url + attribution
centered("terrarium.manticthink.com", font("DejaVuSansMono.ttf", 26), 524, ACCENT)
tracked("SEER  ·  MANTIC THINK  ·  EXPERIMENT", font("DejaVuSans-Bold.ttf", 16), 566, DIM, tracking=3)

out = os.path.join(PUB, "og.png")
base.save(out, "PNG")
print("wrote", out, base.size)
