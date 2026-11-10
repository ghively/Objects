"""Appearance "App icon" (M31, catalog section 1: "App icon (colored icon per device)").

The device setting ``appIcon`` (``default`` or a colour) recolours Object's icon on this
device. The browser tab's icon is the front end's (``settings/appIcon.ts``, the same colours
and shape); this module makes the desktop window's: pywebview takes an icon file only when it
starts (``webview.start(icon=...)``), so a new colour shows from the next start.

``default`` keeps the window as it was (no icon passed). A colour is drawn once into the state
folder (``<state>/app-icon/app-icon-<colour>.png``, ``.ico`` on Windows, which Edge WebView2's
window needs) and reused; nothing in a space is touched.
"""

from __future__ import annotations

import logging
import sys
from io import BytesIO
from pathlib import Path

from .appstate import state_dir
from .textfile import atomic_write

__all__ = ["BOLT_PATH", "COLORS", "DEFAULT_FILL", "ICON_SIZE", "icon_svg", "startup_icon", "window_icon"]

_log = logging.getLogger(__name__)

# The colours (Tailwind's 500 shades, the theme's line colours); the front end's
# `settings/appIcon.ts` holds the same values.
COLORS: dict[str, str] = {
    "red": "#ef4444",
    "orange": "#f97316",
    "green": "#22c55e",
    "blue": "#3b82f6",
    "purple": "#a855f7",
    "pink": "#ec4899",
    "gray": "#71717a",
}

# The default icon's colour (``frontend/public/favicon.svg``'s bolt).
DEFAULT_FILL = "#863bff"

# The bolt of ``favicon.svg`` (viewBox 0 0 48 46), its outer path.
BOLT_PATH = (
    "M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287"
    "c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237"
    "c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894"
    "c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377"
    "c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
)

# The same outline as straight segments, for drawing the window icon.
_BOLT_POINTS: tuple[tuple[float, float], ...] = (
    (25.95, 44.94), (23.93, 44.24), (23.93, 33.94), (21.66, 31.68), (10.29, 31.68),
    (9.37, 29.89), (16.85, 19.42), (15.0, 15.84), (1.24, 15.84), (0.32, 14.05),
    (10.01, 0.47), (10.93, 0.0), (39.83, 0.0), (40.75, 1.79), (33.27, 12.26),
    (35.11, 15.84), (46.49, 15.84), (47.38, 17.67),
)

ICON_SIZE = 256
_SUPERSAMPLE = 4


def icon_svg(color: str) -> str:
    """The icon as a one-colour SVG (``color`` a key of `COLORS`; anything else the default)."""
    fill = COLORS.get(color, DEFAULT_FILL)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="46" fill="none" viewBox="0 0 48 46">'
        f'<path fill="{fill}" d="{BOLT_PATH}"/></svg>'
    )


def _draw(fill: str) -> bytes:
    """The bolt in ``fill`` on a transparent square, as PNG bytes."""
    from PIL import Image, ImageDraw

    big = ICON_SIZE * _SUPERSAMPLE
    scale = big * 0.9 / 48
    dx = (big - 48 * scale) / 2
    dy = (big - 46 * scale) / 2
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(img).polygon([(dx + x * scale, dy + y * scale) for x, y in _BOLT_POINTS], fill=fill)
    out = BytesIO()
    img.resize((ICON_SIZE, ICON_SIZE), Image.Resampling.LANCZOS).save(out, format="PNG")
    return out.getvalue()


def _ico(png: bytes) -> bytes:
    from PIL import Image

    out = BytesIO()
    with Image.open(BytesIO(png)) as img:
        img.save(out, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return out.getvalue()


def window_icon(color: str, folder: Path, platform: str = sys.platform) -> Path | None:
    """The window icon file for ``color`` in ``folder`` (drawn when missing), or None for the
    default icon (or a colour Object doesn't know)."""
    fill = COLORS.get(color)
    if fill is None:
        return None
    ext = ".ico" if platform.startswith("win") else ".png"
    path = Path(folder) / f"app-icon-{color}{ext}"
    if path.is_file():
        return path
    png = _draw(fill)
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, _ico(png) if ext == ".ico" else png)
    return path


def startup_icon(platform: str = sys.platform) -> Path | None:
    """The icon file for the device setting ``appIcon`` at start, or None (the default icon,
    or anything went wrong: a missing icon never stops Object from starting)."""
    try:
        from . import settings

        merged, _revision = settings.read()
        return window_icon(str(merged.get("appIcon") or "default"), state_dir() / "app-icon", platform)
    except Exception:  # noqa: BLE001 - the window opens with its usual icon
        _log.warning("The app icon could not be made; the window keeps its usual icon", exc_info=True)
        return None
