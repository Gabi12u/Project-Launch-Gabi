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


BUTTON_W, BUTTON_H = 200, 20


def build_button_sprite(border, fill, edge_left, edge_right, sheen=False):
    """One of the three vanilla button states, redrawn as a small glass panel.

    `border` must match the real nine_slice border Minecraft ships for this
    exact state (3 for the normal and hovered art, 1 for disabled) - that
    number is not just how this looks at 200x20, it is how the game actually
    slices the corners and edges apart when it stretches a button to whatever
    width its label needs. Getting it right here is what makes a button 400
    pixels wide look the same as one that is 60.
    """
    img = Image.new("RGBA", (BUTTON_W, BUTTON_H), (0, 0, 0, 0))
    px = img.load()
    for y in range(BUTTON_H):
        for x in range(BUTTON_W):
            on_border = x < border or x >= BUTTON_W - border or y < border or y >= BUTTON_H - border
            if on_border:
                t = x / (BUTTON_W - 1)
                px[x, y] = lerp_color(edge_left, edge_right, t) + (255,)
            else:
                px[x, y] = fill
    # A single brighter row just inside the top border: the one cheap trick
    # that still reads as "glass" at 20 pixels tall. Skipped for the 1px
    # disabled border, where there is no room for it to mean anything.
    if sheen and border > 1:
        sheen_color = tuple(min(255, c + 40) for c in fill[:3]) + (fill[3],)
        for x in range(border, BUTTON_W - border):
            px[x, border] = sheen_color
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

    # Vanilla's own nine_slice borders for these three sprites (3, 3, 1),
    # confirmed against the game's actual shipped assets rather than guessed,
    # since a wrong border number would make the corners stretch instead of
    # the flat middle the moment a button is wider or narrower than 200px.
    buttons = {
        "button": (build_button_sprite(3, (26, 14, 40, 215), ACCENT_DEEP, ACCENT_WARM, sheen=True), 3),
        "button_highlighted": (
            build_button_sprite(3, (54, 28, 80, 235), ACCENT, ACCENT_WARM, sheen=True),
            3,
        ),
        "button_disabled": (build_button_sprite(1, (24, 22, 28, 170), (70, 60, 78), (70, 60, 78)), 1),
    }

    mcmeta = {
        "pack": {
            # Placeholder. Rewritten per instance at apply time because a
            # single shipped file has to work across every Minecraft version.
            "pack_format": 34,
            "description": "Launch Gabi, eigene Startseite (Beta)",
        }
    }

    def write(zf, name, data):
        # A plain string name makes zipfile stamp the entry with the current
        # wall-clock time, so the seeded, fully deterministic pixels above
        # still produced a byte-different .zip on every re-run. A fixed
        # ZipInfo date means "nothing visually changed" and "no git diff"
        # actually agree with each other.
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, data)

    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        write(zf, "pack.mcmeta", json.dumps(mcmeta, ensure_ascii=False, indent=2))

        icon_bytes = io.BytesIO()
        icon.save(icon_bytes, format="PNG")
        write(zf, "pack.png", icon_bytes.getvalue())

        for i in range(6):
            buf = io.BytesIO()
            faces[i].convert("RGB").save(buf, format="PNG", optimize=True)
            write(zf, f"assets/minecraft/textures/gui/title/background/panorama_{i}.png", buf.getvalue())

        # Only from 1.20.2 onward does Minecraft look at this path at all
        # (older versions use one single gui/widgets.png sheet instead), so
        # shipping these for every version is harmless: an older client that
        # never asks for gui/sprites/widget/button.png simply never reads it.
        for name, (sprite, border) in buttons.items():
            buf = io.BytesIO()
            sprite.save(buf, format="PNG")
            write(zf, f"assets/minecraft/textures/gui/sprites/widget/{name}.png", buf.getvalue())
            sprite_meta = {
                "gui": {
                    "scaling": {
                        "type": "nine_slice",
                        "width": BUTTON_W,
                        "height": BUTTON_H,
                        "border": border,
                    }
                }
            }
            write(zf, f"assets/minecraft/textures/gui/sprites/widget/{name}.png.mcmeta", json.dumps(sprite_meta, indent=2))

    print(f"Geschrieben: {OUT_ZIP} ({OUT_ZIP.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
