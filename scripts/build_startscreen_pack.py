"""Builds the bundled resource pack for the "eigene Startseite" beta feature.

Generates the six panorama faces Minecraft's title screen expects, plus a
pack icon, and zips them into resources/startscreen/LaunchGabi-Startbildschirm.zip.
The pack_format inside pack.mcmeta is a placeholder; applyCustomStartScreen()
in src/main/core/startScreen.ts rewrites it per instance at apply time, since
one shipped file has to work across every Minecraft version.

Run manually when the artwork should change:
    python scripts/build_startscreen_pack.py

Not part of the app's own runtime and not run by users or CI: this only
regenerates the checked-in .zip asset.
"""

import io
import json
import math
import random
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "resources" / "startscreen"
OUT_ZIP = OUT_DIR / "LaunchGabi-Startbildschirm.zip"

TILE = 1024
STRIP_W = TILE * 4  # the four side faces, laid out so they tile seamlessly
STRIP_H = TILE

# Launch Gabi's own palette, the same one status.launchgabi.com and the
# marketing site use, so the menu looks like it belongs to the same product.
VOID = (10, 5, 18)
ACCENT = (199, 77, 255)
ACCENT_WARM = (255, 92, 200)
ACCENT_DEEP = (124, 42, 232)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))


def build_side_strip():
    """One continuous, horizontally wrapping band. Cropped into four tiles
    afterwards, so any seam between panorama_0..3 is really just a crop line
    through a single image, not a join between four different ones."""
    img = Image.new("RGB", (STRIP_W, STRIP_H))
    px = img.load()

    for y in range(STRIP_H):
        # A vertical gradient alone is already seamless in x, since it does
        # not vary with x at all: void at the top, glow low on the horizon.
        t = y / (STRIP_H - 1)
        base = lerp_color(ACCENT_DEEP, VOID, t**0.6)
        for x in range(STRIP_W):
            px[x, y] = base

    draw = ImageDraw.Draw(img, "RGBA")

    # Aurora ribbons: sine waves whose period divides STRIP_W exactly, so the
    # image wraps from x=STRIP_W-1 back to x=0 without a visible break.
    rng = random.Random(20260901)
    ribbons = [
        (2, 0.34, ACCENT, 70),
        (3, 0.28, ACCENT_WARM, 55),
        (1, 0.44, ACCENT_DEEP, 90),
    ]
    for periods, height_frac, color, alpha in ribbons:
        phase = rng.uniform(0, math.tau)
        base_y = STRIP_H * height_frac
        amp = STRIP_H * 0.05
        points_top = []
        points_bottom = []
        for x in range(0, STRIP_W + 1, 4):
            wave = math.sin((x / STRIP_W) * math.tau * periods + phase)
            y = base_y + amp * wave
            points_top.append((x, y - 34))
            points_bottom.append((x, y + 34))
        polygon = points_top + points_bottom[::-1]
        draw.polygon(polygon, fill=(*color, alpha))

    # Stars: seeded once over the full wrapping width, not per tile, so no
    # star pops in or out of existence at a crop line.
    for _ in range(260):
        x = rng.uniform(0, STRIP_W)
        y = rng.uniform(0, STRIP_H * 0.6)
        r = rng.uniform(0.6, 1.8)
        brightness = rng.randint(140, 255)
        draw.ellipse(
            [x - r, y - r, x + r, y + r],
            fill=(brightness, brightness, min(255, brightness + 20), rng.randint(120, 220)),
        )
        # Wrapped copies near both edges so a star straddling the seam is
        # drawn on both sides of it.
        if x < r * 2:
            draw.ellipse([x + STRIP_W - r, y - r, x + STRIP_W + r, y + r], fill=(brightness, brightness, min(255, brightness + 20), rng.randint(120, 220)))
        if x > STRIP_W - r * 2:
            draw.ellipse([x - STRIP_W - r, y - r, x - STRIP_W + r, y + r], fill=(brightness, brightness, min(255, brightness + 20), rng.randint(120, 220)))

    return img


def edge_color(img, y):
    """Average colour along one horizontal row, used to match the cap images
    to the row of the side strip they border."""
    w, _ = img.size
    r = g = b = 0
    for x in range(0, w, 8):
        pr, pg, pb = img.getpixel((x, y))[:3]
        r += pr
        g += pg
        b += pb
    n = len(range(0, w, 8))
    return (r // n, g // n, b // n)


def build_cap(top_color, bottom_color):
    img = Image.new("RGB", (TILE, TILE))
    px = img.load()
    for y in range(TILE):
        t = y / (TILE - 1)
        c = lerp_color(top_color, bottom_color, t)
        for x in range(TILE):
            px[x, y] = c
    return img


def build_pack_icon():
    """A small rounded gradient tile with an 'L' mark, matching the site logo."""
    size = 128
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        c = lerp_color((124, 42, 232), (255, 92, 200), t)
        draw.line([(0, y), (size, y)], fill=(*c, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=28, fill=255)
    rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rounded.paste(img, (0, 0), mask)
    draw = ImageDraw.Draw(rounded)
    # The wordmark's own "L" stroke: a simple right-angle bar.
    m = size * 0.34
    draw.line([(m, m), (m, size - m)], fill=(255, 255, 255, 255), width=int(size * 0.09))
    draw.line([(m, size - m), (size - m, size - m)], fill=(255, 255, 255, 255), width=int(size * 0.09))
    return rounded


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    strip = build_side_strip()
    top_edge = edge_color(strip, 0)
    bottom_edge = edge_color(strip, STRIP_H - 1)

    faces = {}
    for i in range(4):
        faces[i] = strip.crop((i * TILE, 0, (i + 1) * TILE, STRIP_H))

    # 4 is the top, its downside bordering the top of 0; 5 is the bottom,
    # its top side bordering the bottom of 0 (Minecraft Wiki's own wording).
    faces[4] = build_cap((10, 5, 20), top_edge)
    faces[5] = build_cap(bottom_edge, (4, 2, 8))

    icon = build_pack_icon()

    mcmeta = {
        "pack": {
            # Placeholder. Rewritten per instance at apply time because a
            # single shipped file has to work across every Minecraft version.
            "pack_format": 34,
            "description": "Launch Gabi, eigene Startseite (Beta)",
        }
    }

    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        zf.writestr("pack.mcmeta", json.dumps(mcmeta, ensure_ascii=False, indent=2))

        icon_bytes = io.BytesIO()
        icon.save(icon_bytes, format="PNG")
        zf.writestr("pack.png", icon_bytes.getvalue())

        for i in range(6):
            buf = io.BytesIO()
            faces[i].convert("RGB").save(buf, format="PNG", optimize=True)
            zf.writestr(f"assets/minecraft/textures/gui/title/background/panorama_{i}.png", buf.getvalue())

    print(f"Geschrieben: {OUT_ZIP} ({OUT_ZIP.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
