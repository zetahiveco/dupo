#!/usr/bin/env python3
"""Generate Dupo app icons from app-icon.svg (single source of truth)."""

import os
import subprocess
import shutil
import tempfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SVG = os.path.join(ROOT, "app-icon.svg")
OUT_DIR = os.path.join(ROOT, "src-tauri", "icons")
OUT = 1024
os.makedirs(OUT_DIR, exist_ok=True)


def render_svg(size: int) -> Image.Image:
    """Rasterize the SVG at the requested square size.

    qlmanage composites transparent regions onto white. Crop the squircle out
    (slightly inset to avoid a white fringe), then paste it through an
    anti-aliased rounded-rect mask onto a transparent canvas, keeping the
    proportions from the SVG (824x824 squircle, rx 185, on a 1024 grid).
    """
    work = tempfile.mkdtemp(prefix="dupo-icon-")
    try:
        subprocess.run(
            ["/usr/bin/qlmanage", "-t", "-s", str(size), "-o", work, SVG],
            check=True, capture_output=True,
        )
        produced = os.path.join(
            work, os.path.splitext(os.path.basename(SVG))[0] + ".svg.png")
        with Image.open(produced) as im:
            raw = im.convert("RGB")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    inset = 3  # grid px trimmed inside the squircle edge to drop white fringe
    f = size / 1024
    r = raw.width / 1024
    start = int((100 + inset) * r)
    end = int((924 - inset) * r)
    squircle = raw.crop((start, start, end, end))

    side = int((824 - 2 * inset) * f)
    radius = int((185 - inset) / (824 - 2 * inset) * side)
    mask = Image.new("L", (side * 4, side * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, side * 4 - 1, side * 4 - 1), radius=radius * 4, fill=255)
    mask = mask.resize((side, side), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(squircle.resize((side, side), Image.LANCZOS),
                 (int((100 + inset) * f), int((100 + inset) * f)), mask)
    return canvas


def main():
    big = render_svg(2048).resize((OUT, OUT), Image.LANCZOS)
    big.save(os.path.join(OUT_DIR, "icon.png"))

    iconset = os.path.join(OUT_DIR, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)
    for size in (16, 32, 64, 128, 256, 512, 1024):
        resized = big.resize((size, size), Image.LANCZOS)
        resized.save(os.path.join(iconset, f"icon_{size}x{size}.png"))
        if size <= 512:
            resized.resize((size * 2, size * 2), Image.LANCZOS).save(
                os.path.join(iconset, f"icon_{size}x{size}@2x.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o",
                    os.path.join(OUT_DIR, "icon.icns")], check=True)
    shutil.rmtree(iconset)

    for size, name in ((32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")):
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT_DIR, name))

    big.resize((256, 256), Image.LANCZOS).save(
        os.path.join(OUT_DIR, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"icons written to {OUT_DIR}")


if __name__ == "__main__":
    main()
