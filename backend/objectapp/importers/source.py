"""Reading an import source in place: a ``.zip`` file or a folder, never written.

`open_source` lists a source's files (`Source.files`, source-relative POSIX paths) with their
sizes and modification times, and `Source.read` reads one of them. Nothing in the source is
ever written, renamed, moved or deleted, and nothing is extracted anywhere: a zip is read entry
by entry with `zipfile`, a folder with `os.walk`. Entry names are only ever used to match links;
every file an import writes gets a name computed from a title or an attachment name.

Safety (contract "Safety and limits"):

- A zip entry name is normalised (``\\`` to ``/``, a leading ``./`` dropped, empty parts
  collapsed); one that is absolute, has a drive letter, a ``..`` part, a NUL or characters that
  didn't decode is skipped (``unsafePath``) and never read. In a folder, every file's real path
  must be inside the source's real path.
- Links are ignored: ``os.walk(followlinks=False)``, files that are links or junctions skipped
  (``symlink``); zip entries whose mode marks a link skipped.
- Encrypted entries are skipped (``encrypted``).
- Zip files at the top level of the source (Notion's multi-part export) are read as part of it,
  one level only; deeper ones are skipped (``nestedArchive``).
- A zip whose every entry sits under one folder is read as that folder (our choice).
- Dot-folders are not entered: ``.obsidian/`` is noted for detection and listed once
  (``appSettings``), any other once (``unsupported``); dot-files are listed (``unsupported``).
- Limits: `MAX_ENTRIES` entries (413 above); `Source.read` refuses more than `limit` bytes and
  cuts a zip entry at its declared size (``damaged`` when it yields more); `TextBudget` caps the
  Markdown and CSV text one preview reads (413).

The fingerprint: for a zip, its size and mtime plus every entry's name, size and CRC (nested
zips included); for a folder, every file's relative path, size and mtime.
"""

from __future__ import annotations

import hashlib
import os
import re
import stat
import zipfile
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from .model import SkippedItem

__all__ = [
    "MAX_ENTRIES",
    "MAX_OBJECTS",
    "MAX_PREVIEW_TEXT",
    "MAX_TEXT_FILE",
    "Entry",
    "LimitExceeded",
    "NotASource",
    "Source",
    "SourceDamaged",
    "SourceMissing",
    "TextBudget",
    "open_source",
]

MAX_ENTRIES = 100_000
MAX_OBJECTS = 50_000
MAX_TEXT_FILE = 20 * 1024 * 1024
MAX_PREVIEW_TEXT = 512 * 1024 * 1024

_DRIVE_RE = re.compile(r"^[A-Za-z]:")
_BAD_CHARS_RE = re.compile("[\x00�\ud800-\udfff]")


class SourceMissing(LookupError):
    """No file or folder at the path (404)."""


class NotASource(ValueError):
    """Neither a ``.zip`` nor a folder, or a zip that can't be opened (415)."""


class LimitExceeded(Exception):
    """Over the entry, object or text limits (413)."""


class SourceDamaged(OSError):
    """An entry could not be read as its header says (skipped as ``damaged``)."""


@dataclass
class Entry:
    """One file of the source."""

    path: str
    """Source-relative POSIX path."""
    size: int
    mtime: float
    """Seconds since the epoch (a zip entry's date read as local time)."""
    zip_index: int | None = None
    """Which of `Source._zips` holds it (None: a file in a folder)."""
    info: zipfile.ZipInfo | None = None
    full: str | None = None
    """The file's absolute path (a folder source)."""

    @property
    def mtime_iso(self) -> str:
        moment = datetime.fromtimestamp(self.mtime, UTC)
        return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


@dataclass
class TextBudget:
    """How much Markdown and CSV text one read may take in all (413 above)."""

    limit: int = MAX_PREVIEW_TEXT
    used: int = 0

    def take(self, n: int) -> None:
        self.used += n
        if self.used > self.limit:
            raise LimitExceeded("The source holds more text than one import can read.")


@dataclass
class Source:
    path: Path
    container: str  # 'zip' | 'folder'
    files: dict[str, Entry] = field(default_factory=dict)
    skipped: list[SkippedItem] = field(default_factory=list)
    has_obsidian: bool = False
    """A ``.obsidian/`` folder at the root (detection)."""
    fingerprint: str = ""
    _zips: list[zipfile.ZipFile] = field(default_factory=list)
    _handles: list[object] = field(default_factory=list)

    # -- reading ------------------------------------------------------------------

    def read(self, rel: str, limit: int) -> bytes:
        """The bytes of file ``rel``; raises `SourceDamaged` for an entry that isn't what it says
        or is over ``limit`` bytes (callers check `Entry.size` first)."""
        entry = self.files[rel]
        if entry.size > limit:
            raise SourceDamaged(f"{rel} is larger than {limit} bytes")
        if entry.zip_index is None:
            assert entry.full is not None
            return _read_file(Path(entry.full), Path(self._root_real), entry.size, limit)
        zf = self._zips[entry.zip_index]
        assert entry.info is not None
        try:
            with zf.open(entry.info) as fh:
                data = fh.read(entry.size + 1)
        except (zipfile.BadZipFile, zlib.error, EOFError, OSError, RuntimeError, NotImplementedError) as exc:
            raise SourceDamaged(f"{rel}: {exc}") from exc
        if len(data) != entry.size:
            raise SourceDamaged(f"{rel} is not the size its header says")
        return data

    def close(self) -> None:
        for zf in reversed(self._zips):
            try:
                zf.close()
            except OSError:
                pass
        for h in reversed(self._handles):
            try:
                h.close()  # type: ignore[attr-defined]
            except OSError:
                pass
        self._zips.clear()
        self._handles.clear()

    def __enter__(self) -> Source:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    _root_real: str = ""


def _read_file(full: Path, root_real: Path, size: int, limit: int) -> bytes:
    real = Path(os.path.realpath(full))
    if not real.is_relative_to(root_real):
        raise SourceDamaged(f"{full.name} is outside the source")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    try:
        fd = os.open(full, flags)
    except OSError as exc:
        raise SourceDamaged(str(exc)) from exc
    with os.fdopen(fd, "rb") as fh:
        data = fh.read(limit + 1)
    if len(data) > limit:
        raise SourceDamaged(f"{full.name} is larger than {limit} bytes")
    return data


# -- names --------------------------------------------------------------------------


def normalise_entry_name(name: str) -> str | None:
    """The safe source-relative form of a zip entry name, or None when it is unsafe."""
    if not isinstance(name, str) or _BAD_CHARS_RE.search(name):
        return None
    text = name.replace("\\", "/")
    if text.startswith("/") or _DRIVE_RE.match(text):
        return None
    parts = [p for p in text.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        return None
    return "/".join(parts)


def _is_link_entry(info: zipfile.ZipInfo) -> bool:
    mode = info.external_attr >> 16
    return info.create_system == 3 and stat.S_ISLNK(mode)


def _local_epoch(date_time: tuple[int, ...]) -> float:
    try:
        return datetime(*date_time[:6]).timestamp()  # naive: the zip's local time
    except (ValueError, OverflowError, OSError):
        return 0.0


# -- opening ------------------------------------------------------------------------


def open_source(path: str | Path) -> Source:
    """List the source at ``path``. Raises `SourceMissing` (404), `NotASource` (415) or
    `LimitExceeded` (413). The caller closes it (it holds the zip open)."""
    text = os.path.expanduser(str(path))
    if "\x00" in text or not text.strip():
        raise SourceMissing(text)
    p = Path(text)
    if not p.is_absolute():
        raise SourceMissing(text)
    try:
        st = os.stat(p)
    except (OSError, ValueError) as exc:
        raise SourceMissing(text) from exc
    if stat.S_ISDIR(st.st_mode):
        src = Source(Path(os.path.realpath(p)), "folder")
        src._root_real = str(src.path)
        _list_folder(src)
        return src
    if stat.S_ISREG(st.st_mode) and p.suffix.lower() == ".zip":
        src = Source(p.resolve(), "zip")
        src._root_real = str(src.path.parent)
        try:
            _list_zip(src, st)
        except (zipfile.BadZipFile, zlib.error, OSError, EOFError, ValueError) as exc:
            src.close()
            raise NotASource(f"The zip file can't be opened: {exc}") from exc
        except BaseException:
            src.close()
            raise
        return src
    raise NotASource("Choose a .zip file or a folder.")


class _Lister:
    """Collects one source's files: skip rules, dot-folders, nested zips and the fingerprint."""

    def __init__(self, src: Source) -> None:
        self.src = src
        self.count = 0
        self.dot_listed: set[str] = set()
        self.hash = hashlib.sha256()

    def counted(self) -> None:
        self.count += 1
        if self.count > MAX_ENTRIES:
            raise LimitExceeded(f"The source has more than {MAX_ENTRIES:,} files.")

    def skip(self, path: str, reason: str, detail: str = "") -> None:
        self.src.skipped.append(SkippedItem(path=path, reason=reason, detail=detail))  # type: ignore[arg-type]

    def hidden(self, rel: str) -> bool:
        """True (and listed once per dot-folder) when ``rel`` is in a dot-folder or a dot-file."""
        parts = rel.split("/")
        for i, part in enumerate(parts):
            if not part.startswith(".") and part != "__MACOSX":
                continue
            if i == len(parts) - 1:
                self.skip(rel, "unsupported", "Hidden file")
                return True
            folder = "/".join(parts[: i + 1])
            if folder not in self.dot_listed:
                self.dot_listed.add(folder)
                if folder == ".obsidian":
                    self.src.has_obsidian = True
                    self.skip(folder + "/", "appSettings", "Obsidian's settings")
                elif part == ".trash":
                    self.skip(folder + "/", "unsupported", "Deleted notes")
                else:
                    self.skip(folder + "/", "unsupported", "Hidden folder")
            return True
        return False

    def add(self, entry: Entry) -> None:
        if entry.path in self.src.files:
            self.skip(entry.path, "damaged", "The same path appears twice")
            return
        self.src.files[entry.path] = entry


def _strip_single_top(names: list[str]) -> str:
    """The one folder every (non-``__MACOSX``) entry sits under, or ``""``."""
    top: str | None = None
    for n in names:
        parts = n.split("/")
        if parts[0] == "__MACOSX":
            continue
        if len(parts) < 2:
            return ""
        if top is None:
            top = parts[0]
        elif top != parts[0]:
            return ""
    return (top + "/") if top else ""


def _zip_entries(
    lister: _Lister, zf: zipfile.ZipFile, index: int, prefix_label: str
) -> list[tuple[str, zipfile.ZipInfo]]:
    """The safe file entries of ``zf`` (directories dropped), with the unsafe ones listed."""
    out: list[tuple[str, zipfile.ZipInfo]] = []
    for info in zf.infolist():
        lister.counted()
        lister.hash.update(
            f"{prefix_label}\x00{info.filename}\x00{info.file_size}\x00{info.CRC}\n".encode(
                "utf-8", "surrogateescape"
            )
        )
        raw = info.filename
        if raw.endswith("/") or raw.endswith("\\"):
            if normalise_entry_name(raw) is None:
                lister.skip(_display(raw), "unsafePath")
            continue
        rel = normalise_entry_name(raw)
        if rel is None or not rel:
            lister.skip(_display(raw), "unsafePath")
            continue
        if _is_link_entry(info):
            lister.skip(rel, "symlink")
            continue
        if info.flag_bits & 0x1:
            lister.skip(rel, "encrypted")
            continue
        out.append((rel, info))
    return out


def _display(name: str) -> str:
    """A skipped unsafe name as text the report can show (never used as a path)."""
    text = _BAD_CHARS_RE.sub("?", str(name)).replace("\\", "/")
    return text[:300]


def _list_zip(src: Source, st: os.stat_result) -> None:
    lister = _Lister(src)
    lister.hash.update(f"zip\x00{st.st_size}\x00{st.st_mtime_ns}\n".encode())
    fh = open(src.path, "rb")  # noqa: SIM115 - closed by Source.close
    src._handles.append(fh)
    zf = zipfile.ZipFile(fh)
    src._zips.append(zf)
    entries = _zip_entries(lister, zf, 0, "")
    top = _strip_single_top([rel for rel, _ in entries])
    for rel, info in entries:
        if top and rel.startswith(top):
            rel = rel[len(top):]
        elif top:
            # `__MACOSX/` beside the single top folder.
            if lister.hidden(rel):
                continue
        if lister.hidden(rel):
            continue
        if rel.lower().endswith(".zip"):
            if "/" in rel:
                lister.skip(rel, "nestedArchive")
                continue
            _nested_zip(src, lister, rel, lambda info=info: zf.open(info))
            continue
        src_entry = Entry(rel, info.file_size, _local_epoch(info.date_time), 0, info)
        lister.add(src_entry)
    src.fingerprint = lister.hash.hexdigest()


def _nested_zip(src: Source, lister: _Lister, rel: str, opener) -> None:
    """Read the top-level zip ``rel`` as part of the source (its own nested zips skipped)."""
    try:
        fh = opener()
        src._handles.append(fh)
        inner = zipfile.ZipFile(fh)
    except (zipfile.BadZipFile, zlib.error, OSError, EOFError, ValueError, RuntimeError) as exc:
        lister.skip(rel, "damaged", f"The zip can't be opened: {exc}")
        return
    src._zips.append(inner)
    index = len(src._zips) - 1
    for inner_rel, info in _zip_entries(lister, inner, index, rel):
        if lister.hidden(inner_rel):
            continue
        if inner_rel.lower().endswith(".zip"):
            lister.skip(f"{rel}/{inner_rel}", "nestedArchive")
            continue
        lister.add(Entry(inner_rel, info.file_size, _local_epoch(info.date_time), index, info))


def _list_folder(src: Source) -> None:
    lister = _Lister(src)
    root = str(src.path)
    lister.hash.update(b"folder\n")
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
        keep: list[str] = []
        for d in sorted(dirnames):
            rel = f"{rel_dir}/{d}" if rel_dir else d
            full = os.path.join(dirpath, d)
            lister.counted()
            if os.path.islink(full) or _is_junction(full):
                lister.skip(rel + "/", "symlink")
                continue
            if lister.hidden(rel + "/x"):
                continue
            keep.append(d)
        dirnames[:] = keep
        for name in sorted(filenames):
            rel = f"{rel_dir}/{name}" if rel_dir else name
            full = os.path.join(dirpath, name)
            lister.counted()
            if _BAD_CHARS_RE.search(rel):
                lister.skip(_display(rel), "unsafePath")
                continue
            try:
                lst = os.lstat(full)
            except OSError:
                lister.skip(rel, "damaged", "Can't be read")
                continue
            if stat.S_ISLNK(lst.st_mode) or _is_junction(full):
                lister.skip(rel, "symlink")
                continue
            if not stat.S_ISREG(lst.st_mode):
                lister.skip(rel, "unsupported", "Not a regular file")
                continue
            if not Path(os.path.realpath(full)).is_relative_to(root):
                lister.skip(rel, "unsafePath")
                continue
            if lister.hidden(rel):
                continue
            lister.hash.update(
                f"{rel}\x00{lst.st_size}\x00{lst.st_mtime_ns}\n".encode("utf-8", "surrogateescape")
            )
            if rel.lower().endswith(".zip") and "/" not in rel:
                _nested_zip(src, lister, rel, lambda full=full: open(full, "rb"))  # noqa: SIM115
                continue
            if rel.lower().endswith(".zip"):
                lister.skip(rel, "nestedArchive")
                continue
            lister.add(Entry(rel, lst.st_size, lst.st_mtime, None, None, full))
    src.fingerprint = lister.hash.hexdigest()


def _is_junction(full: str) -> bool:
    isj = getattr(os.path, "isjunction", None)
    try:
        return bool(isj and isj(full))
    except OSError:
        return False


def fingerprint_of(path: str | Path) -> str:
    """The current fingerprint of the source at ``path`` (raises as `open_source`)."""
    with open_source(path) as src:
        return src.fingerprint


def is_markdown(rel: str) -> bool:
    return PurePosixPath(rel).suffix.lower() == ".md"


def is_csv(rel: str) -> bool:
    return PurePosixPath(rel).suffix.lower() == ".csv"

