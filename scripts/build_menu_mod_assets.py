"""Builds the mod's own bundled visual assets under mod/src/main/resources.

Two things happen here:

1. The three button sprites (button, button_highlighted, button_disabled) are
   copied byte-for-byte out of resources/startscreen/LaunchGabi-Startbildschirm.zip
   into the mod's own assets/minecraft/textures/gui/sprites/widget/. Vanilla's
   AbstractButton reads exactly that path (confirmed by reading Minecraft's own
   decompiled source), so a mod shipping files there needs no Mixin at all to
   reskin every AbstractButton-based button in the game, including most mod
   buttons. Reusing the same PNGs the resource pack already ships keeps the
   mod and the separate "eigene Startseite" beta feature visually identical
   instead of two hand-tuned copies drifting apart over time.

2. A new nine-slice panel texture is generated for the translucent backing
   panel TitleScreenMixin draws behind the main menu's button column, using
   the same brand palette as the button sprites and the launcher's own UI.

3. New tooltip background and frame sprites replace vanilla's grey box.
   Minecraft draws tooltips from assets/minecraft/textures/gui/sprites/
   tooltip/{background,frame}.png the same way it draws buttons (confirmed
   by reading TooltipRenderUtil's real decompiled source), so this too
   needs no Mixin, just two more files in the same sprite folder.

4. New language/accessibility icon sprites (the two small square buttons
   flanking Options/Quit) replace vanilla's icon/{language,accessibility}.
   Drawn at 4x and downsampled, since freehand shapes at the native 15x15
   Minecraft actually blits them at (confirmed in SpriteIconButton's real
   source) come out ragged without supersampling first.

Run manually when the artwork should change:
    python scripts/build_menu_mod_assets.py

Not part of the app's own runtime and not run by users or CI: this only
regenerates checked-in files under mod/src/main/resources.
"""

import io
import json
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
STARTSCREEN_ZIP = ROOT / "resources" / "startscreen" / "LaunchGabi-Startbildschirm.zip"
MOD_RESOURCES = ROOT / "mod" / "src" / "main" / "resources"
WIDGET_DIR = MOD_RESOURCES / "assets" / "minecraft" / "textures" / "gui" / "sprites" / "widget"
PANEL_DIR = MOD_RESOURCES / "assets" / "launchgabi_menu" / "textures" / "gui" / "sprites" / "panel"
TOOLTIP_DIR = MOD_RESOURCES / "assets" / "minecraft" / "textures" / "gui" / "sprites" / "tooltip"
ICON_DIR = MOD_RESOURCES / "assets" / "minecraft" / "textures" / "gui" / "sprites" / "icon"

# Same palette as scripts/build_startscreen_pack.py and the launcher's own
# --accent/--accent-2 tokens, so the mod, the resource pack and the launcher
# UI all read as the same product.
ACCENT = (199, 77, 255)
ACCENT_WARM = (255, 92, 200)
ACCENT_DEEP = (124, 42, 232)
PANEL_FILL = (14, 8, 24, 200)

PANEL_SIZE = 48
PANEL_BORDER = 12
PANEL_STROKE = 2
PANEL_RADIUS = 16

TOOLTIP_SIZE = 24
TOOLTIP_BORDER = 6
TOOLTIP_STROKE = 2
TOOLTIP_RADIUS = 7

ICON_SIZE = 15
ICON_SUPERSAMPLE = 4
ICON_COLOR = (235, 225, 255, 255)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))


def copy_button_sprites():
    if not STARTSCREEN_ZIP.exists():
        raise SystemExit(f"Fehlt: {STARTSCREEN_ZIP} (erst scripts/build_startscreen_pack.py laufen lassen)")

    WIDGET_DIR.mkdir(parents=True, exist_ok=True)
    names = ["button", "button_highlighted", "button_disabled"]
    with zipfile.ZipFile(STARTSCREEN_ZIP) as zf:
        for name in names:
            for suffix in (".png", ".png.mcmeta"):
                entry = f"assets/minecraft/textures/gui/sprites/widget/{name}{suffix}"
                data = zf.read(entry)
                (WIDGET_DIR / f"{name}{suffix}").write_bytes(data)


def build_panel_sprite():
    img = Image.new("RGBA", (PANEL_SIZE, PANEL_SIZE), (0, 0, 0, 0))
    px = img.load()
    for y in range(PANEL_SIZE):
        for x in range(PANEL_SIZE):
            on_stroke = (
                x < PANEL_STROKE
                or x >= PANEL_SIZE - PANEL_STROKE
                or y < PANEL_STROKE
                or y >= PANEL_SIZE - PANEL_STROKE
            )
            if on_stroke:
                t = y / (PANEL_SIZE - 1)
                px[x, y] = lerp_color(ACCENT_DEEP, ACCENT_WARM, t) + (235,)
            else:
                px[x, y] = PANEL_FILL

    mask = Image.new("L", (PANEL_SIZE, PANEL_SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, PANEL_SIZE - 1, PANEL_SIZE - 1], radius=PANEL_RADIUS, fill=255
    )
    rounded = Image.new("RGBA", (PANEL_SIZE, PANEL_SIZE), (0, 0, 0, 0))
    rounded.paste(img, (0, 0), mask)
    return rounded


def write_panel_sprite():
    PANEL_DIR.mkdir(parents=True, exist_ok=True)
    sprite = build_panel_sprite()
    buf = io.BytesIO()
    sprite.save(buf, format="PNG")
    (PANEL_DIR / "main_menu_panel.png").write_bytes(buf.getvalue())

    meta = {
        "gui": {
            "scaling": {
                "type": "nine_slice",
                "width": PANEL_SIZE,
                "height": PANEL_SIZE,
                "border": PANEL_BORDER,
            }
        }
    }
    (PANEL_DIR / "main_menu_panel.png.mcmeta").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def write_tooltip_sprites():
    TOOLTIP_DIR.mkdir(parents=True, exist_ok=True)
    size = TOOLTIP_SIZE
    mask = rounded_mask(size, TOOLTIP_RADIUS)

    # Layered the same way vanilla does: background first, then frame drawn
    # on top at the same position and size, so the two textures only need to
    # agree on their rounded silhouette, not repeat each other's pixels.
    background = Image.new("RGBA", (size, size), PANEL_FILL)
    background_rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    background_rounded.paste(background, (0, 0), mask)

    frame = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = frame.load()
    for y in range(size):
        for x in range(size):
            on_stroke = x < TOOLTIP_STROKE or x >= size - TOOLTIP_STROKE or y < TOOLTIP_STROKE or y >= size - TOOLTIP_STROKE
            if on_stroke:
                t = y / (size - 1)
                px[x, y] = lerp_color(ACCENT_DEEP, ACCENT_WARM, t) + (255,)
    frame_rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    frame_rounded.paste(frame, (0, 0), mask)

    meta = {
        "gui": {
            "scaling": {
                "type": "nine_slice",
                "width": TOOLTIP_SIZE,
                "height": TOOLTIP_SIZE,
                "border": TOOLTIP_BORDER,
            }
        }
    }
    for name, img in (("background", background_rounded), ("frame", frame_rounded)):
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        (TOOLTIP_DIR / f"{name}.png").write_bytes(buf.getvalue())
        (TOOLTIP_DIR / f"{name}.png.mcmeta").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def build_language_icon():
    s = ICON_SIZE * ICON_SUPERSAMPLE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    line_w = max(1, round(s * 0.07))
    cx = cy = s / 2
    r = s / 2 - s * 0.08

    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ICON_COLOR, width=line_w)
    draw.line([(cx, cy - r), (cx, cy + r)], fill=ICON_COLOR, width=line_w)
    draw.line([(cx - r, cy), (cx + r, cy)], fill=ICON_COLOR, width=line_w)
    side_rx = r * 0.45
    draw.ellipse([cx - side_rx, cy - r, cx + side_rx, cy + r], outline=ICON_COLOR, width=line_w)
    return img.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)


def build_accessibility_icon():
    s = ICON_SIZE * ICON_SUPERSAMPLE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    line_w = max(1, round(s * 0.09))
    cx = s / 2

    head_r = s * 0.14
    head_cy = s * 0.22
    draw.ellipse([cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r], outline=ICON_COLOR, width=line_w)

    body_top = head_cy + head_r
    body_bottom = s * 0.62
    draw.line([(cx, body_top), (cx, body_bottom)], fill=ICON_COLOR, width=line_w)

    arm_y = s * 0.42
    draw.line([(cx, arm_y), (s * 0.18, s * 0.30)], fill=ICON_COLOR, width=line_w)
    draw.line([(cx, arm_y), (s * 0.82, s * 0.30)], fill=ICON_COLOR, width=line_w)
    draw.line([(cx, body_bottom), (s * 0.22, s * 0.92)], fill=ICON_COLOR, width=line_w)
    draw.line([(cx, body_bottom), (s * 0.78, s * 0.92)], fill=ICON_COLOR, width=line_w)
    return img.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)


def write_icon_sprites():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    icons = {
        "language": build_language_icon(),
        "accessibility": build_accessibility_icon(),
    }
    for name, sprite in icons.items():
        buf = io.BytesIO()
        sprite.save(buf, format="PNG")
        (ICON_DIR / f"{name}.png").write_bytes(buf.getvalue())


def main():
    copy_button_sprites()
    write_panel_sprite()
    write_tooltip_sprites()
    write_icon_sprites()
    print(f"Geschrieben: {WIDGET_DIR} (3 Knopf-Sprites)")
    print(f"Geschrieben: {PANEL_DIR / 'main_menu_panel.png'}")
    print(f"Geschrieben: {TOOLTIP_DIR} (background + frame)")
    print(f"Geschrieben: {ICON_DIR} (language + accessibility)")


if __name__ == "__main__":
    main()
