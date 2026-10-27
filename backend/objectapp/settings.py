"""Device settings: ``<state dir>/settings.json`` (outside every space).

The keys are the M7 contract's ``DeviceSettings``; `read` merges the file over
`DEFAULTS` (a missing file reads as the defaults, revision ``''``, and is not
created). `patch` checks each key's shape, replaces the patched top-level keys,
keeps unknown keys already in the file, and writes atomically against the
revision the caller edited. A file that exists but is not a JSON object is never
replaced (`ReadOnly`, 423).
"""

from __future__ import annotations

import copy
import hashlib
import threading
from pathlib import Path
from typing import Any

from .appstate import state_dir
from .jsonstore import dump_json, parse_json_object
from .textfile import atomic_write
from .typemodel import RevisionConflict

__all__ = ["DEFAULTS", "SettingsProblem", "patch", "read", "settings_path"]

DEFAULTS: dict[str, Any] = {
    "themeMode": "dark",
    "lightTheme": "light",
    "darkTheme": "dark",
    "font": "sans-serif",
    "monochromeTags": False,
    "monochromeTypeLabels": False,
    "toggleStyle": "toggle",
    "disableNumberedListTransformation": False,
    "disableSpellcheck": False,
    "alwaysOpenAsFullPage": False,
    "hideEntityIconsOnInlineLinks": False,
    "hideOutlinerLines": False,
    "twentyFourHourTime": False,
    "dateFormatting": "localized",
    "openOnStart": {},
    "startupSpace": "lastOpened",
    "startupSpacePath": None,
}

_CHOICES: dict[str, tuple[str, ...]] = {
    "themeMode": ("light", "dark"),
    "lightTheme": ("light", "lightDimmed"),
    "darkTheme": ("dark", "darkDimmed"),
    "font": ("sans-serif", "serif", "monospace"),
    "toggleStyle": ("toggle", "bullet"),
    "dateFormatting": ("localized", "DMY", "MDY", "YMD"),
    "startupSpace": ("lastOpened", "specific"),
}
_BOOLS = frozenset(k for k, v in DEFAULTS.items() if isinstance(v, bool))
_OPEN_ON_START_MODES = ("lastOpenedPage", "today", "calendar", "specificObject")

_lock = threading.RLock()


class SettingsProblem(ValueError):
    """A ``PUT /api/settings`` patch has an unknown key or a value of the wrong shape (422)."""

    def __init__(self, key: str) -> None:
        super().__init__(f"Cannot patch: {key}")
        self.key = key
        self.message = f"Cannot patch: {key}"


def settings_path() -> Path:
    return state_dir() / "settings.json"


def _valid(key: str, value: Any) -> bool:
    if key in _CHOICES:
        return isinstance(value, str) and value in _CHOICES[key]
    if key in _BOOLS:
        return isinstance(value, bool)
    if key == "startupSpacePath":
        return value is None or isinstance(value, str)
    if key == "openOnStart":
        if not isinstance(value, dict):
            return False
        for root, entry in value.items():
            if not isinstance(root, str) or not isinstance(entry, dict):
                return False
            if set(entry) - {"mode", "path"} or entry.get("mode") not in _OPEN_ON_START_MODES:
                return False
            if "path" in entry and not isinstance(entry["path"], str):
                return False
        return True
    return False


def _load() -> tuple[dict[str, Any], str, str | None]:
    """(file data, revision, error); ``({}, '', None)`` when there is no file."""
    try:
        raw = settings_path().read_bytes()
    except (FileNotFoundError, NotADirectoryError):
        return {}, "", None
    except OSError as exc:
        return {}, "", f"settings.json can't be read: {exc}"
    revision = hashlib.sha256(raw).hexdigest()
    try:
        return parse_json_object(raw), revision, None
    except (ValueError, UnicodeDecodeError) as exc:
        return {}, revision, f"settings.json is not a valid JSON object: {exc}"


def _merged(data: dict[str, Any]) -> dict[str, Any]:
    """`DEFAULTS` with every well-formed known key of `data` over it."""
    out = copy.deepcopy(DEFAULTS)
    for key in DEFAULTS:
        if key in data and _valid(key, data[key]):
            out[key] = copy.deepcopy(data[key])
    return out


def read() -> tuple[dict[str, Any], str]:
    """(merged settings, revision). Never writes. Raises `ReadOnly` when the file is unreadable."""
    from .space import ReadOnly

    data, revision, error = _load()
    if error is not None:
        raise ReadOnly(error)
    return _merged(data), revision


def patch(patch: dict[str, Any], base_revision: str | None) -> tuple[dict[str, Any], str]:
    """Replace the patched keys in ``settings.json``; return (merged settings, revision).

    Raises `SettingsProblem` (422), `RevisionConflict` (409; a missing file's
    revision is ``''``) and `ReadOnly` (423; the file is left as it is).
    """
    from .space import ReadOnly

    if not isinstance(patch, dict):
        raise SettingsProblem("patch")
    for key, value in patch.items():
        if key not in DEFAULTS or not _valid(key, value):
            raise SettingsProblem(key)
    path = settings_path()
    with _lock:
        data, current, error = _load()
        if error is not None:
            raise ReadOnly(error)
        if current != (base_revision or ""):
            raise RevisionConflict(current)
        data = {**data, **copy.deepcopy(patch)}
        payload = dump_json(data)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, payload)
        return _merged(data), hashlib.sha256(payload).hexdigest()
