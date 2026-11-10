"""Device settings: ``<state dir>/settings.json`` (outside every space).

The keys are the M7 contract's ``DeviceSettings`` plus M8's (language, decimal
separator, time zone, backlink defaults, presentation), M22's ``activityName`` (your
name in a work item's Activity, 1-60 characters, one line) and M23's ``workAlertFolder``
and ``workAlertIntervals`` (the Work section's monitoring folder watch) and ``ocrLanguages`` (the
import's OCR languages, 2026-11-09); `read` merges the file over
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
from .keycompat import upgrade_keys
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
    # 2026-11-09 (Gene): whether the left sidebar is shown when Object opens.
    "showSidebarOnStart": True,
    # 2026-11-09 (Gene): whether an object opens with its properties panel shown.
    "showPropertiesByDefault": True,
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
    "hideTypeSettings": False,
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
    # M24: the work agent (an M17 agent id or None), "Agent acts on my approvals",
    # "Auto-run read-only steps" and the MCP tools a read-only run may use.
    "workAgentId": None,
    "workAgentActs": False,
    "workAutoRun": True,
    "workReadTools": [],
    # 2026-11-09: the languages the import's OCR reads (Tesseract codes joined with ``+``, such as
    # ``eng+deu``); "" means every installed language.
    "ocrLanguages": "",
    # M31 (catalog section 1): Appearance "App icon" (the window and tab icon's colour on this device),
    # Editor "Hide App Menu", Integrations "Show developer information", Offline & Sync "Media loading".
    "appIcon": "default",
    "hideAppMenu": False,
    "showDeveloperInfo": False,
    "mediaLoading": "everything",
    # M31: Full Export (catalog section 1). The manual export's options, and the automated export:
    # on or off, which spaces, the folder each dated export goes into, and how often.
    "fullExportMedia": True,
    "fullExportWikilinks": False,
    "fullExportTitleHeading": False,
    "fullExportAuto": False,
    "fullExportScope": "current",
    "fullExportFolder": None,
    "fullExportInterval": "daily",
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
    "appIcon": ("default", "red", "orange", "green", "blue", "purple", "pink", "gray"),
    "mediaLoading": ("everything", "required"),
    "fullExportScope": ("current", "all"),
    "fullExportInterval": ("daily", "weekly"),
    "nestedBacklinkView": ("showBlockContainingBacklink", "showFullPathAbove"),
    "highlightStyle": ("default", "minimal"),
}
_BOOLS = frozenset(k for k, v in DEFAULTS.items() if isinstance(v, bool))
_OPEN_ON_START_MODES = ("lastOpenedPage", "today", "calendar", "specificObject")
_TRI = ("open", "closed", "hidden")
_PRESENTATION_BOOLS = ("hideCoverImage", "hideProgressIndicator", "hideTitle")
_PRESENTATION_TEXTS = ("footerLeft", "footerRight")

_lock = threading.RLock()


UNKNOWN_SETTING = 'There is no setting named "{key}".'
BAD_SETTING_VALUE = "The setting \"{key}\" can't be saved."


class SettingsProblem(ValueError):
    """A ``PUT /api/settings`` patch has an unknown key or a value of the wrong shape (422).

    The default text is the bad-value sentence; `patch` passes `UNKNOWN_SETTING` for a key
    that is not a setting at all (review 2026-11-08, NIT 7).
    """

    def __init__(self, key: str, message: str | None = None) -> None:
        text = message if message is not None else BAD_SETTING_VALUE.format(key=key)
        super().__init__(text)
        self.key = key
        self.message = text


# M23: the two Work alert keys answer with their own messages.
WORK_ALERT_FOLDER_MAX = 500
WORK_ALERT_INTERVALS_MAX = 50
WORK_ALERT_INTERVAL_MIN = 1
WORK_ALERT_INTERVAL_MAX = 10080
WORK_READ_TOOLS_MAX = 500
_READ_TOOL_ID = re.compile(r"mcp__[A-Za-z0-9_-]{1,64}__\S{1,128}")
_AGENT_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
# Tesseract language codes joined with ``+`` (``eng``, ``chi_sim+eng``, ``script/Latin``); "" is
# "every installed language".
OCR_LANGUAGES_MAX = 200
_OCR_LANG = r"(?:[A-Za-z_]{3,}|script/[A-Za-z_]+)"
_OCR_LANGUAGES = re.compile(_OCR_LANG + r"(?:\+" + _OCR_LANG + r")*")
_PROBLEM_MESSAGES = {
    "ocrLanguages": "OCR languages are Tesseract codes joined with +, for example eng+deu.",
    "workReadTools": "A read tool is mcp__<server>__<tool> (at most 500).",
    "workAgentId": "The work agent is one of Object's agents.",
    "workAlertFolder": "Pick a folder (a full path).",
    "fullExportFolder": "Pick a folder (a full path).",
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
    if key in ("workAlertFolder", "fullExportFolder"):
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
    if key == "workAgentId":
        return value is None or (isinstance(value, str) and _AGENT_ID.fullmatch(value) is not None)
    if key == "workReadTools":
        return (
            isinstance(value, list)
            and len(value) <= WORK_READ_TOOLS_MAX
            and all(isinstance(v, str) and _READ_TOOL_ID.fullmatch(v) is not None for v in value)
        )
    if key == "ocrLanguages":
        return isinstance(value, str) and (
            value == "" or (len(value) <= OCR_LANGUAGES_MAX and _OCR_LANGUAGES.fullmatch(value) is not None)
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
        data = parse_json_object(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        return {}, revision, f"settings.json is not a valid JSON object: {exc}"
    upgrade_keys(data)  # older key names, renamed in memory only
    return data, revision, None


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
        raise SettingsProblem("patch", "The patch must be an object.")
    for key, value in patch.items():
        if key not in DEFAULTS:
            raise SettingsProblem(key, UNKNOWN_SETTING.format(key=key))
        if not _valid(key, value):
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
