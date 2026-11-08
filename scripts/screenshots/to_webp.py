"""Convert the captured PNGs to the WebP files the README uses.

    uv run python scripts/screenshots/to_webp.py <png folder> docs/images
"""

import sys
from pathlib import Path

from PIL import Image

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
for p in sorted(src.glob("*.png")):
    im = Image.open(p).convert("RGB")
    im = im.resize((im.width * 2 // 3, im.height * 2 // 3), Image.LANCZOS)  # 2880x1800 -> 1920x1200
    im.save(out / f"{p.stem}.webp", "WEBP", quality=84, method=6)
    print(out / f"{p.stem}.webp")
