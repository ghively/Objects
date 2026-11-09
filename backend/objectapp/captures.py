"""Brain dumps: the Capture type, the save and the filing outcomes (M24 T3).

A capture is saved first (one create write, Status New) and never deleted by filing: filing only
sets Status, Filed to and Question (and writes the one place it files to).
"""

from __future__ import annotations

import copy
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from .apiquery import append_to_section, is_excluded
from .propvalues import InvalidValue, decode_value
from .typemodel import PropertyDefinition, is_task_type
from .watcher import ChangeEvent
from .workagentmodel import ALREADY_FILED, EMPTY_CAPTURE, QueueRefused
from .workbody import one_line

if TYPE_CHECKING:
    from .space import Space
    from .typemodel import TypeDefinition
    from .worksection_model import CaptureRequestModel
    from .workservice import Actor, WorkService

__all__ = [
    "BREAK_DOWN",
    "CAPTURE_TEXT_MAX",
    "CAPTURE_TYPE_NAME",
    "CAPTURE_TYPE_PLURAL",
    "QUESTION",
    "CaptureSeam",
    "CaptureStatus",
    "Outcome",
    "Parsed",
    "Route",
    "apply_outcome",
    "capture",
    "ensure_capture_type",
    "list_captures",
    "parse_prefix",
    "resolve_item",
    "save",
    "set_status",
]

log = logging.getLogger(__name__)

CAPTURE_TYPE_NAME = "Capture"
CAPTURE_TYPE_PLURAL = "Captures"
CAPTURE_TYPE_ICON = "ph-lightbulb"
CAPTURE_TYPE_COLOR = "pink"
CAPTURE_TEXT_MAX = 8000  # M22's note cap
TITLE_MAX = 80
CaptureStatus = Literal["new", "filed", "needsYou"]
Route = Literal["file", "breakDown", "question"]
Outcome = Literal["workNote", "step", "task", "fact", "needsYou"]
BREAK_DOWN = re.compile(r"(?is)^\s*break\s*down\s+(?P<item>.+?)\s+step\s+(?P<n>\d{1,2})\s*:\s*(?P<rest>.*)$")
QUESTION = re.compile(r"(?is)^\s*question\s+about\s+(?P<item>.+?)\s*:\s*(?P<rest>.+)$")

K_TEXT, K_AT, K_VIEW, K_LINKED = "captureText", "capturedAt", "fromView", "linkedItem"
K_STATUS, K_FILED, K_QUESTION = "captureStatus", "filedTo", "question"
STATUS_OPTIONS = (("new", "New", "pink"), ("filed", "Filed", "green"), ("needs-you", "Needs you", "amber"))
STATUS_TEXT: dict[str, str] = {"new": "New", "filed": "Filed", "needsYou": "Needs you"}
_TEXT_TO_STATUS = {v.casefold(): k for k, v in STATUS_TEXT.items()}
TOO_LONG = "A brain dump is at most 8,000 characters."
NO_ADD_APPROVE = "A brain dump adds no Approve step."
SAY_WHAT = "Say what you need to know."


@dataclass(frozen=True)
class Parsed:
    route: Route
    item_ref: str | None
    step_n: int | None
    rest: str


def parse_prefix(text: str) -> Parsed:
    """``Break down <item> step n: ...`` and ``Question about <item>: ...`` route a capture to that item
    ("BREAKDOWN ..." matches too); anything else is filed as typed."""
    m = BREAK_DOWN.match(text)
    if m:
        return Parsed("breakDown", m.group("item").strip(), int(m.group("n")), m.group("rest").strip())
    m = QUESTION.match(text)
    if m:
        return Parsed("question", m.group("item").strip(), None, m.group("rest").strip())
    return Parsed("file", None, None, text)


# -- the type -------------------------------------------------------------------------------


def _define(key: str, name: str, kind: str, icon: str, options: dict | None = None) -> PropertyDefinition:
    return PropertyDefinition.from_json({
        "id": key, "key": key, "name": name, "type": kind, "description": "",
        "icon": {"type": "iconify", "val": icon}, "visibility": "alwaysShow", "options": options or {},
    })


def _property_defs() -> list[PropertyDefinition]:
    def entity() -> dict:
        return {"isArray": False, "allowedTypes": [], "hasFixedSet": False, "fixedSet": []}

    return [
        _define(K_TEXT, "Text", "textBlock", "ph-text-align-left"),
        _define(K_AT, "Captured at", "datetime", "ph-calendar",
                {"constraints": {"resolutionPreference": "time"}}),
        _define(K_VIEW, "From view", "text", "ph-text-t"),
        _define(K_LINKED, "Linked item", "entity", "ph-link", entity()),
        _define(K_STATUS, "Status", "label", "ph-trend-up", {
            "isArray": False,
            "set": [{"id": i, "text": t, "color": c, "icon": None} for i, t, c in STATUS_OPTIONS],
        }),
        _define(K_FILED, "Filed to", "entity", "ph-folder-simple", entity()),
        _define(K_QUESTION, "Question", "text", "ph-question"),
    ]


def find_capture_type(space: Space) -> TypeDefinition | None:
    t = space.type_by_id("capture")
    if t is not None and t.name.casefold() == CAPTURE_TYPE_NAME.casefold():
        return t
    for t in space.types:
        if t.name.casefold() == CAPTURE_TYPE_NAME.casefold():
            return t
    return None


def ensure_capture_type(space: Space) -> tuple[TypeDefinition, bool]:
    """The Capture type with its seven properties, made or completed as needed; (type, changed)."""
    changed = False
    t = find_capture_type(space)
    if t is None:
        t = space.create_type(CAPTURE_TYPE_NAME, CAPTURE_TYPE_PLURAL, icon=CAPTURE_TYPE_ICON,
                              color=CAPTURE_TYPE_COLOR)
        changed = True
    have = {p.key for p in t.propertyDefinitions}
    missing = [p for p in _property_defs() if p.key not in have]
    if missing:
        new = copy.deepcopy(t)
        new.propertyDefinitions.extend(missing)
        _current, revision = space.refresh_type(t.id)
        space.save_type(new, revision)
        t = space.type_by_id(t.id) or new
        changed = True
    return t, changed


# -- visibility and lookup ------------------------------------------------------------------


def _hidden(space: Space) -> set[str]:
    with space._lock:
        return {
            rel for rel, s in space._summaries.items()
            if s.template is not None or is_excluded(space._raw[rel].fm if rel in space._raw else None, s.tags)
        }


def _visible(space: Space, path: str) -> str:
    """The space path of a shown object; KeyError when missing, excluded or a template."""
    rel = space._rel(path)
    with space._lock:
        known = rel in space._summaries
    if not known or rel in _hidden(space):
        raise KeyError(rel)
    return rel


def resolve_item(service: WorkService, ref: str) -> dict | None:
    """A work item (summary) named by a ``[[Title]]`` link, Ticket ID, title, object id or path."""
    space = service.space
    ref = (ref or "").strip()
    if not ref:
        return None
    hidden = _hidden(space)
    items = [i for i in service.items("all") if i["path"] not in hidden]
    m = re.fullmatch(r"\[\[(.+?)\]\]", ref)
    if m:
        target = m.group(1).split("|", 1)[0].strip()
        try:
            rel = space.resolve(target, None)
        except Exception:  # noqa: BLE001 - an unresolvable link is just no match
            rel = None
        for i in items:
            if rel is not None and i["path"] == rel:
                return i
        ref = target
    folded = ref.casefold()

    def ticket_id(i: dict) -> str:
        t = i.get("ticket")
        return str(t.get("id") or "") if isinstance(t, dict) else ""

    for match in (
        lambda i: ticket_id(i).casefold() == folded,
        lambda i: str(i.get("title") or "").casefold() == folded,
        lambda i: bool(i.get("objectId")) and str(i["objectId"]).casefold() == folded,
        lambda i: i["path"].casefold() == folded,
    ):
        for i in items:
            if match(i):
                return i
    return None


# -- reading --------------------------------------------------------------------------------


def _item_from(space: Space, t: TypeDefinition, rel: str, fm: dict, version: str) -> dict:
    def val(key: str) -> Any:
        p = t.prop(key)
        return decode_value(p, fm.get(key), fm) if p is not None else None

    text = val(K_TEXT) or ""
    at = val(K_AT)
    status_texts = val(K_STATUS) or []
    status = _TEXT_TO_STATUS.get(str(status_texts[0]).casefold(), "new") if status_texts else "new"

    def link(key: str) -> tuple[str | None, str | None]:
        refs = val(key) or []
        if not refs:
            return None, None
        target = refs[0].get("target")
        try:
            path = space.resolve(target, rel)
        except Exception:  # noqa: BLE001
            path = None
        if path is None:
            return None, target
        try:
            return path, space.get(path).title
        except KeyError:
            return None, target

    linked_path, linked_title = link(K_LINKED)
    filed_path, filed_title = link(K_FILED)
    with space._lock:
        summary = space._summaries.get(rel)
    return {
        "path": rel,
        "text": text,
        "status": status,
        "question": val(K_QUESTION) or None,
        "capturedAt": at.get("start") if isinstance(at, dict) else str(fm.get("createdAt") or ""),
        "linkedPath": linked_path,
        "objectId": summary.id if summary else fm.get("id"),
        "version": version,
        "title": summary.title if summary else one_line(text, TITLE_MAX),
        "fromView": val(K_VIEW) or None,
        "linkedTitle": linked_title,
        "filedTo": {"path": filed_path, "title": filed_title or filed_path} if filed_path else None,
        "route": parse_prefix(text).route,
    }


def capture(space: Space, path: str) -> dict:
    """The CaptureItem at ``path`` (KeyError when it isn't a capture)."""
    t = find_capture_type(space)
    rel = space._rel(path)
    if t is None:
        raise KeyError(rel)
    with space._lock:
        summary = space._summaries.get(rel)
    if summary is None or summary.type != t.id:
        raise KeyError(rel)
    _of, fm, version = space.read(rel)
    return _item_from(space, t, rel, fm, version)


def list_captures(space: Space, status: CaptureStatus | None = None) -> list[dict]:
    """CaptureItem[], newest first; never writes."""
    t = find_capture_type(space)
    if t is None:
        return []
    out: list[dict] = []
    hidden = _hidden(space)
    for s in space.list(t.id):
        if s.path in hidden:
            continue
        try:
            _of, fm, version = space.read(s.path)
        except (KeyError, OSError, ValueError):
            continue
        item = _item_from(space, t, s.path, fm, version)
        if status is None or item["status"] == status:
            out.append(item)
    out.sort(key=lambda c: (c["capturedAt"] or "", c["path"]), reverse=True)
    return out


# -- saving ---------------------------------------------------------------------------------


def _fmt_at(now: datetime) -> str:
    now = now.astimezone(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def save(space: Space, service: WorkService, *, text: str, from_view: str | None, linked_path: str | None,
         now: datetime) -> tuple[dict, Parsed, dict | None]:
    """Save the brain dump: ONE create write carrying every value, Status New.

    Answers (CaptureItem, the effective parse, the linked work item or None)."""
    if not text or not text.strip():
        raise InvalidValue(EMPTY_CAPTURE)
    if len(text) > CAPTURE_TEXT_MAX:
        raise InvalidValue(TOO_LONG)
    parsed = parse_prefix(text)
    item: dict | None = None
    link_rel: str | None = None
    if linked_path:
        try:
            link_rel = _visible(space, linked_path)
        except (KeyError, ValueError):
            link_rel = None
        if link_rel is not None:
            item = next((i for i in service.items("all") if i["path"] == link_rel), None)
    elif parsed.route != "file" and parsed.item_ref:
        item = resolve_item(service, parsed.item_ref)
        link_rel = item["path"] if item else None
    route = parsed.route
    if route != "file":
        if item is None:
            route = "file"
        elif route == "breakDown":
            try:
                steps = service.item(item["path"]).get("steps") or []
            except Exception:  # noqa: BLE001
                steps = []
            n = parsed.step_n or 0
            if not (1 <= n <= len(steps)) or steps[n - 1].get("state") in ("done", "declined"):
                route = "file"
    effective = parsed if route == parsed.route else Parsed("file", None, None, text)
    t, _changed = ensure_capture_type(space)
    values: dict[str, Any] = {
        K_TEXT: text,
        K_AT: {"start": _fmt_at(now), "resolution": "time"},
        K_STATUS: [STATUS_TEXT["new"]],
    }
    if from_view:
        values[K_VIEW] = from_view
    if link_rel is not None:
        values[K_LINKED] = [_link(space, link_rel)]
    title = one_line(text, TITLE_MAX)
    if title.endswith("..."):  # a plain YAML scalar ending in "..." reads as a document end
        title = title[:-3] + "\u2026"
    path, _version = space.create_object(t.id, title, "none", values, body="")
    return capture(space, path), effective, item


# -- outcomes -------------------------------------------------------------------------------


def _basic_task_type(space: Space) -> TypeDefinition:
    for t in space.types:
        if is_task_type(t):
            return t
    raise InvalidValue("This space has no Task type.")


def _ref_path(space: Space, service: WorkService, ref: str) -> str:
    """A work item named by path or by `resolve_item`; KeyError when hidden or missing."""
    try:
        return _visible(space, ref)
    except (KeyError, ValueError):
        found = resolve_item(service, ref)
        if found is None:
            raise KeyError(ref) from None
        return found["path"]


def _write_props(space: Space, path: str, updates: dict[str, Any], remove: list[str] | None = None,
                 base_version: str | None = None) -> dict:
    from .space import Conflict

    for attempt in (0, 1):
        _of, _fm, version = space.read(path)
        if base_version is not None and version != base_version:
            raise Conflict(version)
        try:
            space.update_properties(path, updates, version, remove=list(remove or []))
            break
        except Conflict:
            if attempt or base_version is not None:
                raise
    return capture(space, path)


def _link(space: Space, rel: str) -> dict[str, Any]:
    return {"target": space.get(rel).title, "path": rel}


def apply_outcome(space: Space, service: WorkService, capture_path: str, outcome: Outcome, actor: Actor, *,
                  item: str | None = None, text: str | None = None, step_kind: str | None = None,
                  step_text: str | None = None, task_title: str | None = None, page: str | None = None,
                  section: str | None = None, question: str | None = None) -> dict:
    """File the capture one way; nothing is deleted. Answers ``{"capture": CaptureItem, "filedTo": path or
    None, "written": [(path, version)]}`` (``written``: the other objects written, for the caller to announce)."""
    cap_rel = _visible(space, capture_path)
    cap = capture(space, cap_rel)
    if cap["status"] != "new":
        raise QueueRefused(409, ALREADY_FILED)
    body_text = text if text is not None and text.strip() else cap["text"]
    written: list[tuple[str, str | None]] = []
    filed_rel: str | None = None
    if outcome == "needsYou":
        if not question or not question.strip():
            raise InvalidValue(SAY_WHAT)
    elif outcome == "workNote":
        filed_rel = _ref_path(space, service, item or "")
        res = service.note(filed_rel, "note", body_text, actor)
        written.append((filed_rel, res.get("version")))
    elif outcome == "step":
        if step_kind not in ("question", "do", "agent"):
            raise InvalidValue(NO_ADD_APPROVE)
        if not step_text or not step_text.strip():
            raise InvalidValue("A step needs text.")
        filed_rel = _ref_path(space, service, item or "")
        res = service.edit_steps(
            filed_rel, [{"op": "add", "kind": step_kind, "text": step_text.strip()}], actor)
        written.append((filed_rel, res.get("version")))
    elif outcome == "task":
        title = (task_title or "").strip()
        if not title:
            raise InvalidValue("A task needs a title.")
        t = _basic_task_type(space)
        filed_rel, version = space.create_object(t.id, title, "none", None, body=cap["text"])
        written.append((filed_rel, version))
    elif outcome == "fact":
        filed_rel = _visible(space, page or "")
        of, _fm, version = space.read(filed_rel)
        heading = (section or "Notes").strip() or "Notes"
        new = append_to_section(of.body, heading, body_text)
        if new is None:
            nl = "\r\n" if "\r\n" in of.body else "\n"
            base = of.body if not of.body or of.body.endswith(("\n", "\r")) else of.body + nl
            new = base + (nl if base else "") + f"## {heading}" + nl + nl + body_text.replace("\n", nl) + nl
        written.append((filed_rel, space.save_body(filed_rel, new, version)))
    else:
        raise InvalidValue(f'Unknown outcome "{outcome}".')
    if outcome == "needsYou":
        assert question is not None
        done = _write_props(space, cap_rel, {K_STATUS: [STATUS_TEXT["needsYou"]], K_QUESTION: question.strip()})
    else:
        assert filed_rel is not None
        done = _write_props(space, cap_rel,
                            {K_STATUS: [STATUS_TEXT["filed"]], K_FILED: [_link(space, filed_rel)]})
    return {"capture": done, "filedTo": filed_rel, "written": written}


def set_status(space: Space, capture_path: str, status: CaptureStatus, *, base_version: str | None,
               filed_to: str | None = None, question: str | None = None, reply: str | None = None) -> dict:
    """Mark filed (Gene), Reply (back to New, Question cleared, ``Reply: <text>`` added to Text) and
    Object's own Filed-to; one property write. A stale ``base_version`` raises `Conflict`."""
    cap_rel = _visible(space, capture_path)
    cap = capture(space, cap_rel)
    updates: dict[str, Any] = {K_STATUS: [STATUS_TEXT[status]]}
    remove: list[str] = []
    if reply is not None:
        joined = f"{cap['text']}\n\nReply: {reply.strip()}"
        if len(joined) > CAPTURE_TEXT_MAX:
            raise InvalidValue(TOO_LONG)
        updates[K_TEXT] = joined
        remove.append(K_QUESTION)
    elif question is not None:
        updates[K_QUESTION] = question
    if filed_to:
        updates[K_FILED] = [_link(space, _visible(space, filed_to))]
    return _write_props(space, cap_rel, updates, remove, base_version)


class CaptureSeam:
    """M23's `CaptureSink`: the save, then the queue entry."""

    def __init__(self, service: WorkService) -> None:
        self.service = service

    def save(self, space: Space, req: CaptureRequestModel, now: datetime) -> dict:
        from .workloop import loop_for

        origin = req.clientId
        had_type = find_capture_type(space) is not None
        item, parsed, linked = save(space, self.service, text=req.text, from_view=req.fromView,
                                    linked_path=req.linkedPath, now=now)
        try:
            loop = loop_for(space)
        except KeyError:
            return item
        if not had_type:
            t = find_capture_type(space)
            if t is not None:
                loop.announce(ChangeEvent("types", t.id, None, origin=origin))
        loop.announce(ChangeEvent("created", item["path"], item["version"], origin=origin))
        try:
            loop.enqueue_capture(item, parsed, linked)
        except Exception:  # noqa: BLE001 - the save stands; scan_unqueued_captures picks it up
            log.exception("Queueing the brain dump %s failed", item["path"])
        return item

    def list(self, space: Space, status: str | None) -> list[dict[str, Any]]:
        return list_captures(space, status)  # type: ignore[arg-type]
