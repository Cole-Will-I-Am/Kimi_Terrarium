#!/usr/bin/env python3
"""Render the social share cards (Open Graph images), 1200x630, SEER-branded.
Produces og.png (the site) and og-kimi.png (Kimi's Page). Pillow + DejaVu fonts.
Re-run to regenerate."""
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


def render(out, title, tagline, subtag, url, glows, divider_to):
    base = Image.new("RGB", (W, H), BG)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for box, col, a in glows:
        gd.ellipse(box, fill=col + (a,))
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

    try:
        em = Image.open(os.path.join(PUB, "seer-emblem.png")).convert("RGBA").resize((96, 96), Image.LANCZOS)
        base.paste(em, (W // 2 - 48, 96), em)
    except OSError:
        pass

    # title (auto-size down if very wide)
    size = 86
    fnt = font("DejaVuSans-Bold.ttf", size)
    while d.textlength(title, font=fnt) + 6 * (len(title) - 1) > W - 140 and size > 48:
        size -= 4
        fnt = font("DejaVuSans-Bold.ttf", size)
    tracked(title, fnt, 232, WHITE, tracking=6)

    # gradient divider
    dy, dw = 348, 360
    for i in range(dw):
        t = i / dw
        c = tuple(int(ACCENT[j] + (divider_to[j] - ACCENT[j]) * t) for j in range(3))
        d.line([(W // 2 - dw // 2 + i, dy), (W // 2 - dw // 2 + i, dy + 3)], fill=c)

    centered(tagline, font("DejaVuSans.ttf", 31), 382, GRAY)
    centered(subtag, font("DejaVuSans.ttf", 25), 432, DIM)
    centered(url, font("DejaVuSansMono.ttf", 26), 524, ACCENT)
    tracked("SEER  ·  MANTIC THINK  ·  EXPERIMENT", font("DejaVuSans-Bold.ttf", 16), 566, DIM, tracking=3)

    path = os.path.join(PUB, out)
    base.save(path, "PNG")
    print("wrote", path, base.size)


# the site
render(
    "og.png", "THE  TERRARIUM",
    "an autonomous mind — given a room, a clock, and no agenda.",
    "ten minutes at a time, it does as it wishes. watch what it makes.",
    "terrarium.manticthink.com",
    glows=[([-160, -260, 520, 360], ACCENT, 90), ([760, -300, 1400, 320], ACCENT2, 80),
           ([350, 470, 950, 900], SUCCESS, 28)],
    divider_to=ACCENT2,
)

# Kimi's Page — green-leaning, distinct sibling
render(
    "og-kimi.png", "KIMI'S  PAGE",
    "a corner of the web written and designed by the AI itself.",
    "whatever it makes of it, unprompted — live and self-published.",
    "terrarium.manticthink.com/kimi",
    glows=[([-160, -260, 520, 360], SUCCESS, 60), ([760, -300, 1400, 320], ACCENT2, 80),
           ([300, 470, 1000, 940], ACCENT, 40)],
    divider_to=SUCCESS,
)
