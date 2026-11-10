"""Full Export (M31; catalog section 1, General, "Full Export").

"Manual Full Export with Spaces (All Spaces) and options Include media, Links as wikilinks
(``[[title]]``), Add the title as a top heading; "Export All Spaces"", and "Automated Full
Exports": every object of one space, or of every registered space, as a tree of Markdown files
in a folder of the user's choosing, for reading outside Object.

The tree: one fresh dated folder per run, ``Object export <space> <YYYY-MM-DD HHMM>`` (``All
Spaces`` in place of the name for every space), holding one folder per space named after it
(`safe_filename`; `` (2)`` for a second space of the same name). Each object lands at its own
space path with the bytes the single-object Markdown export gives it (`export._markdown`'s
rules, re-done here over a read that leaves the space's caches alone, see `_object_markdown`):
the file's own bytes by default, the title as heading 1 with ``title_heading``, ``[[links]]`` as
relative Markdown links when ``wikilinks`` is off (each object sits at its own path, so the
links resolve inside the export) and synced facts (M29) in the front matter. With ``media`` the
space's attachments, every file an object references and whiteboard sidecars are copied at their
space paths. Our calls: ``.object/`` (types, collections, version history), the caches, the trash
and templates are left out (an export is for reading outside Object, and none of them is an
object one reads); objects excluded from AI are exported (it is the user's own export).

File safety: nothing is written inside any space (a destination inside a space, registered or
not, is refused with `Refused`), never on read, and nothing in a space's ``.object-cache`` (the
frontmatter cache is bypassed: ``read_raw(cache=False)``). The run builds in a hidden
``.<name>.partial-<id>`` folder in the destination and renames it into place at the end, so the
dated folder appears whole or not at all; a failed run removes its partial folder.

`FullExportJobs` runs manual exports in the background with progress; `AutoFullExport` is the
automated one: when ``fullExportAuto`` is on it exports ``fullExportScope`` into
``fullExportFolder`` once per ``fullExportInterval`` (daily or weekly), checking on a timer
from server start, and records its last run in the state dir (``full-export.json``). A folder
that is unset, missing or inside a space skips the run (`AutoFullExport.status` says why). One
export runs at a time in the process (`_RUN_LOCK`), manual or automated.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import uuid
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Any

from .export import (
    _FM_RE,
    ExportOptions,
    _paths_for_wikilinks,
    _title,
    _type_of,
    _with_synced,
    referenced_media,
)
from .frontmatter import FlowList
from .jsonstore import JsonStore
from .media import list_attachments
from .resolver import Resolver
from .space import _str_list, _str_or_none, _title_of, safe_filename
from .synced import FOLDER as SYNCED_FOLDER
from .synced import SyncedStore, synced_props
from .textfile import atomic_write
from .typedefs import RawObject, iter_object_paths, read_raw
from .typemodel import TypeDefinition, _parse
from .whiteboardfile import sidecar_owner

__all__ = [
    "INTERVALS",
    "SCOPES",
    "STATE_FILE",
    "AutoFullExport",
    "Busy",
    "FullExportJobs",
    "FullExportOptions",
    "FullExportResult",
    "Refused",
    "check_destination",
    "export_folder_name",
    "run_full_export",
]

SCOPES = ("current", "all")
INTERVALS = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}
STATE_FILE = "full-export.json"
ALL_SPACES = "All Spaces"  # the catalog's "Spaces (All Spaces)"
RETRY_AFTER = timedelta(hours=1)
"""A failed automated run is tried again after this long (our choice), not on every check."""
CHECK_SECONDS = 60.0
"""How often the automated export looks whether a run is due (our choice)."""

_log = logging.getLogger(__name__)

_RUN_LOCK = threading.Lock()
"""Held for the whole of every export in this process: never two at once."""


class Refused(ValueError):
    """The export can't run: the message says why, in the user's words."""


class Busy(Refused):
    """Another export is running (one at a time)."""


@dataclass(frozen=True)
class FullExportOptions:
    """The three options (device settings ``fullExportMedia``, ``fullExportWikilinks``,
    ``fullExportTitleHeading``)."""

    media: bool = True
    wikilinks: bool = False
    title_heading: bool = False

    @classmethod
    def from_settings(cls, settings: dict[str, Any]) -> FullExportOptions:
        return cls(
            media=settings.get("fullExportMedia", True) is not False,
            wikilinks=settings.get("fullExportWikilinks") is True,
            title_heading=settings.get("fullExportTitleHeading") is True,
        )


@dataclass
class SpaceResult:
    name: str
    folder: str
    """The space's folder name inside the export folder."""
    objects: int = 0
    media: int = 0

    def to_api(self) -> dict[str, Any]:
        return {"name": self.name, "folder": self.folder, "objects": self.objects, "media": self.media}


@dataclass
class FullExportResult:
    folder: str
    """The dated export folder (a full path)."""
    spaces: list[SpaceResult] = field(default_factory=list)

    @property
    def objects(self) -> int:
        return sum(s.objects for s in self.spaces)

    @property
    def media(self) -> int:
        return sum(s.media for s in self.spaces)

    def to_api(self) -> dict[str, Any]:
        return {
            "folder": self.folder,
            "spaces": [s.to_api() for s in self.spaces],
            "objects": self.objects,
            "media": self.media,
        }


# -- reading a space without writing to it -----------------------------------------------


def _scan_objects(root: Path) -> Iterator[tuple[str, RawObject]]:
    """A space's objects, one read at a time (an unreadable file and the templates left out),
    from the files only: the frontmatter cache is bypassed."""
    for rel in iter_object_paths(root):
        try:
            raw = read_raw(root, rel, cache=False)
        except OSError:
            continue
        if not raw.readOnly and _str_or_none(raw.fm.get("template")):
            continue  # a template is no object (our call: left out)
        yield rel, raw


def _media_paths(root: Path, objects: Iterable[tuple[str, RawObject]]) -> list[str]:
    """The space paths of the files "Include media" copies: every attachment, every file one of
    ``objects`` references and every whiteboard sidecar of one of them."""
    found: dict[str, None] = {a["path"]: None for a in list_attachments(root)}
    names: set[str] = set()
    for rel, raw in objects:
        names.add(rel)
        for item in referenced_media(root, rel, raw.fm, raw.of.body):
            found.setdefault(item, None)
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        base = Path(folder).relative_to(root).as_posix()
        for name in files:
            rel = name if base == "." else f"{base}/{name}"
            owner = sidecar_owner(rel)
            if owner is not None and owner in names and not os.path.islink(os.path.join(folder, name)):
                found.setdefault(rel, None)
    return sorted(found)


def _count_files(root: Path, media: bool) -> int:
    """How many files a space's export writes (its objects, and its media with ``media``),
    counted reading one object at a time, so no space is held in memory to count it."""
    seen = 0

    def each() -> Iterator[tuple[str, RawObject]]:
        nonlocal seen
        for item in _scan_objects(root):
            seen += 1
            yield item

    if media:
        return len(_media_paths(root, each())) + seen
    for _item in each():
        pass
    return seen


class _SpaceView:
    """What the Markdown export reads of a space (``root``, ``types``, ``synced``, ``resolve``),
    read from its files only: no `Space` is opened (that writes the frontmatter cache and purges
    the trash), no type file is migrated and the frontmatter cache is bypassed. It holds every
    object's bytes, so a run builds one space's view at a time and releases it before the next."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self.types = _read_types(self.root)
        self.synced = SyncedStore(JsonStore(self.root, SYNCED_FOLDER, {}))
        self.objects: dict[str, RawObject] = dict(_scan_objects(self.root))
        summaries = [
            SimpleNamespace(
                path=rel,
                title=_title_of(raw),
                createdAt=_str_or_none(raw.fm.get("createdAt")),
                template=None,
            )
            for rel, raw in self.objects.items()
        ]
        aliases = {rel: _str_list(raw.fm.get("aliases")) for rel, raw in self.objects.items()}
        self._resolver = Resolver.build(summaries, aliases)  # type: ignore[arg-type]

    def resolve(self, link: str, from_path: str | None) -> str | None:
        return self._resolver.resolve(link, from_path)

    def media(self) -> list[str]:
        """The space paths of the files "Include media" copies (`_media_paths`)."""
        return _media_paths(self.root, self.objects.items())


def _read_types(root: Path) -> list[TypeDefinition]:
    """``.object/types/*.json`` as they are (an unreadable file is skipped; nothing migrated)."""
    out: list[TypeDefinition] = []
    try:
        files = sorted((root / ".object" / "types").glob("*.json"))
    except OSError:
        return out
    for f in files:
        try:
            out.append(TypeDefinition.from_json(_parse(f.read_bytes()), fallback_id=f.stem))
        except (OSError, ValueError, UnicodeDecodeError, TypeError, KeyError):
            continue
    return out


def _synced_lines(view: _SpaceView, raw: RawObject) -> tuple[dict[str, Any], list[str]] | None:
    """`export._synced_lines` over an object already read."""
    tdef = _type_of(view, raw)
    props = synced_props(tdef)
    if not props:
        return None
    fm = view.synced.overlay(tdef, raw.fm)
    sets: dict[str, Any] = {}
    drops: list[str] = []
    for p in props:
        if p.key in fm:
            if raw.fm.get(p.key) != fm[p.key]:
                value = fm[p.key]
                sets[p.key] = FlowList(value) if isinstance(value, list) else value
        elif p.key in raw.fm:
            drops.append(p.key)
    return (sets, drops) if sets or drops else None


def _object_markdown(view: _SpaceView, rel: str, raw: RawObject, opts: ExportOptions) -> bytes:
    """The bytes `export._markdown` gives ``rel`` exported at its own path (``zip_path=rel``),
    from the read `_SpaceView` made (so the frontmatter cache is never touched)."""
    data = raw.data
    synced = _synced_lines(view, raw)
    if not opts.title_h1 and opts.wikilinks and synced is None:
        return data
    bom = data.startswith(b"\xef\xbb\xbf")
    text = data[3 if bom else 0 :].decode("utf-8", "surrogateescape")
    nl = "\r\n" if "\r\n" in text else "\n"
    m = _FM_RE.match(text)
    head, body = (text[: m.end()], text[m.end() :]) if m else ("", text)
    if synced is not None and head:
        head = _with_synced(head, nl, *synced)
    if not opts.wikilinks:
        body = _paths_for_wikilinks(view, rel, body, PurePosixPath(rel).parent.as_posix(), None)  # type: ignore[arg-type]
    if opts.title_h1:
        title = _title(raw, rel)
        first = body.lstrip("\r\n").split("\n", 1)[0].rstrip("\r")
        if first.strip() != f"# {title}":
            body = f"# {title}{nl}{nl}" + body.lstrip("\r\n")
    out = (head + body).encode("utf-8", "surrogateescape")
    return (b"\xef\xbb\xbf" if bom else b"") + out


# -- the destination ------------------------------------------------------------------------


def _key(path: Path) -> str:
    return os.path.normcase(os.path.normpath(os.fspath(path)))


def _within(child: Path, parent: Path) -> bool:
    c, p = _key(child), _key(parent)
    return c == p or c.startswith(p.rstrip(os.sep) + os.sep)


def _is_space_folder(path: Path) -> bool:
    try:
        return (path / ".object").is_dir()
    except OSError:
        return False


def check_destination(folder: str | os.PathLike[str] | None, spaces: Iterable[Path]) -> Path:
    """The destination as a resolved folder; raises `Refused` when it is unset, not a full
    path, not there, or inside a space (one of ``spaces``, or any folder holding ``.object``)."""
    text = os.fspath(folder) if folder is not None else ""
    if not text.strip():
        raise Refused("Pick a folder for the export.")
    dest = Path(text)
    if not dest.is_absolute():
        raise Refused("Pick a folder (a full path).")
    if not dest.is_dir():
        raise Refused(f"The folder {text} isn't there.")
    dest = dest.resolve()
    for root in spaces:
        try:
            resolved = Path(root).resolve()
        except OSError:
            continue
        if _within(dest, resolved):
            raise Refused("Pick a folder outside your spaces: an export never writes inside a space.")
    for candidate in (dest, *dest.parents):
        if _is_space_folder(candidate):
            raise Refused("Pick a folder outside your spaces: an export never writes inside a space.")
    return dest


def export_folder_name(label: str, now: datetime) -> str:
    """``Object export <label> <YYYY-MM-DD HHMM>`` (``now`` in local time)."""
    return safe_filename(f"Object export {label} {now:%Y-%m-%d %H%M}")


def _unique(parent: Path, name: str, taken: set[str] | None = None) -> str:
    """``name``, or ``name (2)``, ``(3)``... when it exists in ``parent`` or is in ``taken``."""
    taken = taken or set()
    out, n = name, 2
    while out.casefold() in taken or (parent / out).exists():
        out = f"{name} ({n})"
        n += 1
    return out


# -- the run --------------------------------------------------------------------------------


def run_full_export(
    spaces: list[tuple[str, Path]],
    destination: str | os.PathLike[str],
    options: FullExportOptions,
    now: datetime,
    *,
    label: str | None = None,
    all_spaces: Iterable[Path] = (),
    progress: Callable[[int, int], None] | None = None,
) -> FullExportResult:
    """Export ``spaces`` (``(name, folder)`` each) into a new dated folder in ``destination``.

    ``label`` names the dated folder (the one space's name, or ``All Spaces``); ``all_spaces``
    are the folders the destination must lie outside of besides ``spaces``. ``progress(done,
    total)`` is called as files are written. Raises `Refused` (the destination) and `OSError`
    (a write failed; nothing is left behind). Holds `_RUN_LOCK` while it runs.
    """
    with _RUN_LOCK:
        return _run(spaces, destination, options, now, label, all_spaces, progress)


def _run(spaces, destination, options, now, label, all_spaces, progress) -> FullExportResult:
    roots = [Path(root) for _name, root in spaces]
    dest = check_destination(destination, [*roots, *map(Path, all_spaces)])
    opts = ExportOptions(media=options.media, wikilinks=options.wikilinks, title_h1=options.title_heading)
    # Count first, one object at a time; then read, export and release one space at a time, so
    # All Spaces never holds every space's notes in memory at once.
    counts = [_count_files(Path(root), options.media) for _name, root in spaces]
    total = sum(counts)
    done = 0
    if progress:
        progress(0, total)
    if label is None:
        label = spaces[0][0] if len(spaces) == 1 else ALL_SPACES
    final = _unique(dest, export_folder_name(label, now))
    partial = dest / f".{final}.partial-{uuid.uuid4().hex[:8]}"
    partial.mkdir()
    result = FullExportResult(folder=str(dest / final))
    try:
        taken: set[str] = set()
        for (name, root), counted in zip(spaces, counts, strict=True):
            view = _SpaceView(Path(root))
            media = view.media() if options.media else []
            files = len(view.objects) + len(media)
            if files != counted:  # the space changed since it was counted: the total follows
                total += files - counted
                if progress:
                    progress(done, total)
            folder = _unique(partial, safe_filename(name), taken)
            taken.add(folder.casefold())
            out = partial / folder
            out.mkdir()
            entry = SpaceResult(name=name, folder=folder)
            for rel, raw in view.objects.items():
                target = out / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(_object_markdown(view, rel, raw, opts))
                entry.objects += 1
                done += 1
                if progress:
                    progress(done, total)
            for rel in media:
                source = view.root / rel
                target = out / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.copy2(source, target)
                except FileNotFoundError:
                    pass  # gone since it was listed: skipped like a missing file
                else:
                    entry.media += 1
                done += 1
                if progress:
                    progress(done, total)
            result.spaces.append(entry)
            del view, media  # released before the next space is read
        os.rename(partial, dest / final)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    return result


# -- manual exports: background jobs ---------------------------------------------------------


class FullExportJobs:
    """Manual exports, one at a time, on a worker thread; their progress and outcome by id."""

    KEEP = 10

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}

    def running(self) -> dict[str, Any] | None:
        with self._lock:
            return next((dict(j) for j in self._jobs.values() if j["state"] == "running"), None)

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job is not None else None

    def start(
        self,
        scope: str,
        spaces: list[tuple[str, Path]],
        destination: str,
        options: FullExportOptions,
        now: datetime,
        *,
        all_spaces: Iterable[Path] = (),
        label: str | None = None,
    ) -> dict[str, Any]:
        """Check the destination, then run the export on a thread; the job as it starts.

        Raises `Refused` (the destination) and `Busy` (an export is running).
        """
        all_spaces = list(all_spaces)
        check_destination(destination, [*(Path(r) for _n, r in spaces), *map(Path, all_spaces)])
        if _RUN_LOCK.locked() or self.running() is not None:
            raise Busy("An export is running. Wait for it to finish.")
        job_id = uuid.uuid4().hex[:12]
        job: dict[str, Any] = {
            "id": job_id,
            "state": "running",
            "scope": scope,
            "done": 0,
            "total": 0,
            "result": None,
            "error": None,
        }
        with self._lock:
            self._jobs[job_id] = job
            for old in list(self._jobs)[: -self.KEEP]:
                del self._jobs[old]

        def progress(done: int, total: int) -> None:
            with self._lock:
                job["done"], job["total"] = done, total

        def work() -> None:
            try:
                res = run_full_export(
                    spaces, destination, options, now, label=label, all_spaces=all_spaces, progress=progress
                )
            except Refused as exc:
                outcome = {"state": "failed", "error": str(exc)}
            except OSError as exc:
                outcome = {"state": "failed", "error": f"The export could not be written: {exc.strerror or exc}"}
            except Exception as exc:  # noqa: BLE001 - a job reports, never kills the worker
                outcome = {"state": "failed", "error": f"The export failed: {exc}"}
            else:
                outcome = {"state": "done", "result": res.to_api()}
            with self._lock:
                job.update(outcome)

        threading.Thread(target=work, name=f"full-export-{job_id}", daemon=True).start()
        return dict(job)

    def wait(self, job_id: str, timeout: float = 30.0) -> dict[str, Any] | None:
        """Wait until the job is no longer running (tests); the job."""
        end = datetime.now(UTC) + timedelta(seconds=timeout)
        event = threading.Event()
        while datetime.now(UTC) < end:
            job = self.get(job_id)
            if job is None or job["state"] != "running":
                return job
            event.wait(0.02)
        return self.get(job_id)


# -- automated exports -----------------------------------------------------------------------


def _parse_instant(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        out = datetime.fromisoformat(value)
    except ValueError:
        return None
    return out if out.tzinfo is not None else out.replace(tzinfo=UTC)


def _iso(when: datetime) -> str:
    return when.astimezone(UTC).isoformat().replace("+00:00", "Z")


class AutoFullExport:
    """"Automated Full Exports": a timer from server start that runs the export when due.

    ``settings()`` gives the device settings; ``spaces(scope)`` the ``(name, folder)`` pairs to
    export and ``all_spaces()`` every registered space folder; ``clock()`` "now" (UTC);
    ``local(now)`` turns it into the local time the folder is named with; ``state_dir()`` where
    ``full-export.json`` (``lastRun``, ``lastFolder``, ``lastAttempt``, ``lastError``) lives.
    """

    def __init__(
        self,
        settings: Callable[[], dict[str, Any]],
        spaces: Callable[[str], list[tuple[str, Path]]],
        all_spaces: Callable[[], list[Path]],
        clock: Callable[[], datetime],
        state_dir: Callable[[], Path],
        local: Callable[[datetime], datetime] = lambda d: d.astimezone(),
        check_seconds: float = CHECK_SECONDS,
    ) -> None:
        self._settings = settings
        self._spaces = spaces
        self._all_spaces = all_spaces
        self._clock = clock
        self._state_dir = state_dir
        self._local = local
        self._check_seconds = check_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._running = False

    # -- the record ---------------------------------------------------------------------

    def _state_path(self) -> Path:
        return Path(self._state_dir()) / STATE_FILE

    def record(self) -> dict[str, Any]:
        """``full-export.json`` as it is ({} when there is none or it can't be read)."""
        try:
            data = json.loads(self._state_path().read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write_record(self, data: dict[str, Any]) -> None:
        path = self._state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, (json.dumps(data, indent=2) + "\n").encode("utf-8"))

    # -- status -------------------------------------------------------------------------

    def _read_settings(self) -> dict[str, Any]:
        try:
            return self._settings()
        except Exception:  # noqa: BLE001 - an unreadable settings file means "off"
            return {}

    def blocked(self, settings: dict[str, Any] | None = None) -> str | None:
        """Why an automated run can't happen now (the folder), or None."""
        s = self._read_settings() if settings is None else settings
        folder = s.get("fullExportFolder")
        if not isinstance(folder, str) or not folder:
            return "Pick a folder for the automated exports."
        try:
            check_destination(folder, [*(r for _n, r in self._spaces("all")), *self._all_spaces()])
        except Refused as exc:
            return str(exc)
        return None

    def next_run(self, settings: dict[str, Any] | None = None, now: datetime | None = None) -> datetime | None:
        """When the next run is due (``now`` when it never ran), or None when it is off."""
        s = self._read_settings() if settings is None else settings
        if s.get("fullExportAuto") is not True:
            return None
        rec = self.record()
        interval = INTERVALS.get(str(s.get("fullExportInterval")), INTERVALS["daily"])
        last = _parse_instant(rec.get("lastRun"))
        due = (now or self._clock()) if last is None else last + interval
        attempt = _parse_instant(rec.get("lastAttempt"))
        if rec.get("lastError") and attempt is not None and (last is None or attempt > last):
            due = max(due, attempt + RETRY_AFTER)
        return due

    def status(self) -> dict[str, Any]:
        s = self._read_settings()
        rec = self.record()
        nxt = self.next_run(s)
        return {
            "enabled": s.get("fullExportAuto") is True,
            "scope": s.get("fullExportScope", "current"),
            "folder": s.get("fullExportFolder"),
            "interval": s.get("fullExportInterval", "daily"),
            "lastRun": rec.get("lastRun"),
            "lastFolder": rec.get("lastFolder"),
            "lastError": rec.get("lastError"),
            "nextRun": _iso(nxt) if nxt is not None else None,
            "blocked": self.blocked(s) if s.get("fullExportAuto") is True else None,
            "running": self._running,
        }

    # -- the timer ----------------------------------------------------------------------

    def tick(self, now: datetime | None = None) -> FullExportResult | None:
        """Run the export when it is on, due and its folder can be used; the result, or None.

        Skips (None) while another export runs: never two at once.
        """
        now = now or self._clock()
        s = self._read_settings()
        if s.get("fullExportAuto") is not True:
            return None
        due = self.next_run(s, now)
        if due is None or now < due or self.blocked(s) is not None:
            return None
        if not _RUN_LOCK.acquire(blocking=False):
            return None
        scope = s.get("fullExportScope") if s.get("fullExportScope") in SCOPES else "current"
        self._running = True
        try:
            spaces = self._spaces(scope)
            try:
                result = _run(
                    spaces,
                    s["fullExportFolder"],
                    FullExportOptions.from_settings(s),
                    self._local(now),
                    ALL_SPACES if scope == "all" else None,
                    self._all_spaces(),
                    None,
                )
            except (Refused, OSError) as exc:
                rec = self.record()
                rec.update(lastAttempt=_iso(now), lastError=getattr(exc, "strerror", None) or str(exc))
                self._write_record(rec)
                return None
            self._write_record(
                {"lastRun": _iso(now), "lastFolder": result.folder, "lastAttempt": _iso(now), "lastError": None}
            )
            return result
        finally:
            self._running = False
            _RUN_LOCK.release()

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()

        def loop() -> None:
            while not self._stop.is_set():
                try:
                    self.tick()
                except Exception:  # noqa: BLE001 - the timer keeps going
                    _log.warning("The automated full export check failed", exc_info=True)
                self._stop.wait(self._check_seconds)

        self._thread = threading.Thread(target=loop, name="full-export-auto", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=5)
