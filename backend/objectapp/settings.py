"""Device settings: ``<state dir>/settings.json`` (outside every space).

The keys are the M7 contract's ``DeviceSettings`` plus M8's (language, decimal
separator, time zone, backlink defaults, presentation), M22's ``activityName`` (your
name in a work item's Activity, 1-60 characters, one line) and M23's ``workAlertFolder``
and ``workAlertIntervals`` (the Work section's monitoring folder watch); `read` merges the file over
`DEFAULTS` (a missing file reads as the defaults, revision ``''``, and is not
created). `patch` checks each key's shape, replaces the patched top-level keys,
keeps unknown keys already in the file, and writes atomically against the
revision the caller edited. A file that exists but is not a JSON object is never
replaced (`ReadOnly`, 423).
"""

from __future__ import annotations

import copy
import hashlib
import math
import re
import threading
import zoneinfo
from pathlib import Path
from typing import Any

from .aimodels import MODEL_PATTERN
from .appstate import state_dir
from .jsonstore import dump_json, parse_json_object
from .textfile import atomic_write
from .typemodel import RevisionConflict

__all__ = [
    "DEFAULTS",
    "SettingsProblem",
    "patch",
    "read",
    "settings_path",
    "time_zone",
    "valid_time_zone",
]

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
    # M8 (plan Task 2): formatting locale, numbers, time zone, references, presentation.
    "language": "en",
    "decimalSeparator": "automatic",
    "timeZone": None,
    "backlinkSectionsDefault": {
        "backlinks": "open",
        "relatedContent": "open",
        "unlinkedMentions": "open",
    },
    "backlinkContentView": "embed",
    "relatedContentHiddenTypes": [],
    "nestedBacklinkView": "showBlockContainingBacklink",
    "presentation": {
        "hideCoverImage": False,
        "hideProgressIndicator": False,
        "hideTitle": False,
        "footerLeft": "",
        "footerRight": "",
    },
    # Polish 2026-11-03: the desktop zoom factor; scales the
    # rem-based UI and editor text from the 15.5px root.
    "zoom": 1.0,
    # Editor settings: the spellcheck language tag (None: the
    # device's), the link and type-settings switches, and the highlight block style.
    "spellCheckLang": None,
    "alwaysCreateInlineLinks": False,
    "hideStructureSettings": False,
    "highlightStyle": "default",
    # M10: the AI assistant ("Hide AI features", where the Claude Code CLI is, its model).
    "aiHidden": False,
    "claudePath": None,
    "aiModel": None,
    # M22: who "you" are in a work item's Activity and Work notes lines.
    "activityName": "Gene",
    # M23: the monitoring folder the Work section's folder watch reads (absolute path or
    # None: off), and per-source staleness intervals in minutes.
    "workAlertFolder": None,
    "workAlertIntervals": {},
}

# A model name or alias for ``claude --model``: the one rule, in `aimodels` (M16).
_AI_MODEL = re.compile(MODEL_PATTERN)

# A BCP 47 language tag as the normaliser accepts it ("fr", "de-CH", "en_GB",
# "es-419"), at most 35 characters.
_LANGUAGE_TAG = re.compile(r"[A-Za-z]{2,3}(?:[-_](?:[A-Za-z]{2}|\d{3})(?:[-_][A-Za-z0-9]{1,8})*)?")

# `setZoomLevel` steps by 0.05 and stops at 1.5 (in) and 0.6 (out).
ZOOM_MIN = 0.6
ZOOM_MAX = 1.5

_CHOICES: dict[str, tuple[str, ...]] = {
    "themeMode": ("light", "dark"),
    "lightTheme": ("light", "lightDimmed"),
    "darkTheme": ("dark", "darkDimmed"),
    "font": ("sans-serif", "serif", "monospace"),
    "toggleStyle": ("toggle", "bullet"),
    "dateFormatting": ("localized", "DMY", "MDY", "YMD"),
    "startupSpace": ("lastOpened", "specific"),
    "language": ("en", "en-gb", "de", "fr", "es", "it", "nl", "pt-br", "hu"),
    "decimalSeparator": ("automatic", "dot", "comma"),
    "backlinkContentView": ("inline", "smallCard", "wideCard", "embed"),
    "nestedBacklinkView": ("showBlockContainingBacklink", "showFullPathAbove"),
    "highlightStyle": ("default", "minimal"),
}
_BOOLS = frozenset(k for k, v in DEFAULTS.items() if isinstance(v, bool))
_OPEN_ON_START_MODES = ("lastOpenedPage", "today", "calendar", "specificObject")
_TRI = ("open", "closed", "hidden")
_PRESENTATION_BOOLS = ("hideCoverImage", "hideProgressIndicator", "hideTitle")
_PRESENTATION_TEXTS = ("footerLeft", "footerRight")

_lock = threading.RLock()


class SettingsProblem(ValueError):
    """A ``PUT /api/settings`` patch has an unknown key or a value of the wrong shape (422)."""

    def __init__(self, key: str, message: str | None = None) -> None:
        text = message if message is not None else f"Cannot patch: {key}"
        super().__init__(text)
        self.key = key
        self.message = text


# M23: the two Work alert keys answer with their own messages.
WORK_ALERT_FOLDER_MAX = 500
WORK_ALERT_INTERVALS_MAX = 50
WORK_ALERT_INTERVAL_MIN = 1
WORK_ALERT_INTERVAL_MAX = 10080
_PROBLEM_MESSAGES = {
    "workAlertFolder": "Pick a folder (a full path).",
    "workAlertIntervals": "Intervals are whole minutes from 1 to 10080.",
}


def settings_path() -> Path:
    return state_dir() / "settings.json"


def valid_time_zone(name: Any) -> bool:
    """True for an IANA zone name `zoneinfo` can load (the bundled `tzdata` on Windows)."""
    if not isinstance(name, str) or not name.strip() or name != name.strip():
        return False
    try:
        zoneinfo.ZoneInfo(name)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError, OSError):
        return False
    return True


def _valid(key: str, value: Any) -> bool:
    if key in _CHOICES:
        return isinstance(value, str) and value in _CHOICES[key]
    if key in _BOOLS:
        return isinstance(value, bool)
    if key == "zoom":
        return (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            and ZOOM_MIN <= value <= ZOOM_MAX
        )
    if key == "claudePath":
        return value is None or (isinstance(value, str) and 0 < len(value) <= 1024 and "\x00" not in value)
    if key == "aiModel":
        return value is None or (isinstance(value, str) and _AI_MODEL.fullmatch(value) is not None)
    if key == "activityName":
        return (
            isinstance(value, str)
            and 1 <= len(value) <= 60
            and value.strip() != ""
            and "\n" not in value
            and "\r" not in value
        )
    if key == "workAlertFolder":
        return value is None or (
            isinstance(value, str)
            and 0 < len(value) <= WORK_ALERT_FOLDER_MAX
            and value == value.strip()
            and not any(c in value for c in "\x00\r\n")
            and Path(value).is_absolute()
        )
    if key == "workAlertIntervals":
        return (
            isinstance(value, dict)
            and len(value) <= WORK_ALERT_INTERVALS_MAX
            and all(
                isinstance(k, str)
                and 1 <= len(k) <= 100
                and isinstance(v, int)
                and not isinstance(v, bool)
                and WORK_ALERT_INTERVAL_MIN <= v <= WORK_ALERT_INTERVAL_MAX
                for k, v in value.items()
            )
        )
    if key == "startupSpacePath":
        return value is None or isinstance(value, str)
    if key == "spellCheckLang":
        return value is None or (
            isinstance(value, str) and len(value) <= 35 and _LANGUAGE_TAG.fullmatch(value) is not None
        )
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
    if key == "timeZone":
        return value is None or valid_time_zone(value)
    if key == "backlinkSectionsDefault":
        return (
            isinstance(value, dict)
            and set(value) == set(DEFAULTS[key])
            and all(isinstance(v, str) and v in _TRI for v in value.values())
        )
    if key == "relatedContentHiddenTypes":
        return isinstance(value, list) and all(isinstance(v, str) for v in value)
    if key == "presentation":
        return (
            isinstance(value, dict)
            and set(value) == set(DEFAULTS[key])
            and all(isinstance(value[k], bool) for k in _PRESENTATION_BOOLS)
            and all(isinstance(value[k], str) for k in _PRESENTATION_TEXTS)
        )
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
            raise SettingsProblem(key, _PROBLEM_MESSAGES.get(key))
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


def time_zone(merged: dict[str, Any]) -> zoneinfo.ZoneInfo | None:
    """The ``timeZone`` setting as a zone; None for the device's zone (or a bad name)."""
    name = merged.get("timeZone")
    return zoneinfo.ZoneInfo(name) if valid_time_zone(name) else None
