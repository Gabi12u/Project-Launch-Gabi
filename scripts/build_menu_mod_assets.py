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


def main():
    copy_button_sprites()
    write_panel_sprite()
    print(f"Geschrieben: {WIDGET_DIR} (3 Knopf-Sprites)")
    print(f"Geschrieben: {PANEL_DIR / 'main_menu_panel.png'}")


if __name__ == "__main__":
    main()
