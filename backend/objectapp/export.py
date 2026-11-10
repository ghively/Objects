"""Exporting one object (M9): its ``.md`` as it is, or a zip with the media it references.

The object's "Export" offers Markdown with the option "Include media" ("Adds files and
images to the zip."). An Object file already is Markdown with wikilinks, so the export is the
file's own bytes; with media it is a zip of ``<stem>.md`` plus every image and attachment the
file references, each at its space-relative path (so the file's links still resolve inside
the zip). Polish item 23 adds the dialog's other choices (`ExportOptions`): Markdown with
subpages (a zip of the embedded objects, followed to any depth), the title as heading 1 and
links as paths instead of wikilinks; and the PDF (a printable page), Word and LaTeX formats,
built by `exportdoc`.

A referenced file is one named by ``coverImage``, a Markdown image or link
(``![alt](path)``, ``[text](path)``) or a wikilink (``![[path]]``) outside code. Each is
checked with `media.attachment_path`: missing files, paths outside the space or in a
dot-folder, whiteboard sidecars and ``.md`` objects are skipped. A path that isn't a file
there is looked up as the editor does (`findAttachment` in ``editor/media/upload.ts``,
Obsidian's short form): the attachment at that path ignoring case, else (a bare file name)
the first attachment with that file name. Exporting reads only the space: the zip is
written to a temporary file in the system temp folder (``<temp>/object-exports``, never
in the space or the app's state dir) and streamed from there (`export_object_to_file`), so a 100 MB attachment is
never held in memory; the file is removed once sent (`Export.cleanup`), and files older
than an hour that a crash left behind are removed by the next export.
"""

from __future__ import annotations

import io
import os
import posixpath
import re
import tempfile
import time
import zipfile
from dataclasses import dataclass, field, replace
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, unquote

from .exportdoc import Doc, parse_blocks, render_docx, render_html, render_latex
from .frontmatter import FlowList, FrontmatterError, delete_keys, set_keys
from .media import Attachment, NotServed, attachment_path, list_attachments
from .objfile import join_object, split_object
from .propvalues import TABLE_KIND, decode_value, table_one_line
from .relink import code_ranges, wikilink_spans, wikilink_targets
from .synced import synced_props
from .typedefs import read_raw

if TYPE_CHECKING:
    from .space import Space
    from .typemodel import TypeDefinition

__all__ = [
    "FORMATS",
    "Export",
    "ExportOptions",
    "build_doc",
    "content_disposition",
    "export_dir",
    "export_object",
    "export_object_to_file",
    "export_properties",
    "referenced_media",
]

# ``![alt](path "title")`` / ``[text](<path with spaces>)``: the destination only. A bare
# destination may hold one level of balanced parentheses (``shot%20(2).png``) and, since this
# only names files to look for, spaces too (``shot (2).png`` as hand-written Markdown has it).
_MD_LINK_RE = re.compile(
    r"!?\[[^\]\n]*\]\(\s*(?:<([^>\n]*)>|((?:[^()\n]|\([^()\n]*\))+?))"
    r"\s*(?:\"[^\"\n]*\"|'[^'\n]*')?\s*\)"
)
_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


_STALE_SECONDS = 3600


class Export:
    """A download: its bytes (or the temporary ``file`` holding them), file name and media type."""

    def __init__(
        self, data: bytes, filename: str, media_type: str, file: Path | None = None
    ) -> None:
        self.data = data
        self.filename = filename
        self.media_type = media_type
        self.file = file
        """A temporary file to send instead of ``data`` (then ``data`` is empty); see `cleanup`."""

    def cleanup(self) -> None:
        """Remove the temporary ``file`` (call it once the response is sent). Idempotent."""
        if self.file is not None:
            try:
                self.file.unlink()
            except FileNotFoundError:
                pass
            except OSError:  # still open elsewhere (Windows): the next export's sweep removes it
                pass


def export_dir() -> Path:
    """Where media exports are assembled: the system temp folder's ``object-exports``.

    Outside every space and outside the app's state dir, which reads must leave unchanged
    (the M9 acceptance checks that an export adds nothing there).
    """
    return Path(tempfile.gettempdir()) / "object-exports"


def _sweep(folder: Path, now: float) -> None:
    """Remove export files a crash or an aborted download left behind (older than an hour)."""
    try:
        entries = list(os.scandir(folder))
    except OSError:
        return
    for entry in entries:
        try:
            if entry.is_file() and now - entry.stat().st_mtime > _STALE_SECONDS:
                os.unlink(entry.path)
        except OSError:
            continue


def _outside_code(text: str) -> str:
    """``text`` with fenced code blocks and inline code spans blanked out."""
    out = list(text)
    for start, end in code_ranges(text):
        out[start:end] = " " * (end - start)
    return "".join(out)


def _candidates(rel: str, fm: dict, body: str) -> list[str]:
    """The paths the object names, in order of appearance (the cover first)."""
    found: list[str] = []
    cover = fm.get("coverImage")
    if isinstance(cover, str) and cover.strip():
        found.append(cover.strip())
    plain = _outside_code(body)
    for m in _MD_LINK_RE.finditer(plain):
        target = (m.group(1) if m.group(1) is not None else m.group(2)).strip()
        if target and not target.startswith("#") and not _SCHEME_RE.match(target):
            found.append(unquote(target))
    found.extend(sorted(wikilink_targets(body)))
    folder = PurePosixPath(rel).parent.as_posix()
    if folder != ".":
        # A path relative to the object's own folder, after the space-relative reading.
        found.extend(f"{folder}/{p}" for p in list(found) if not p.startswith("/"))
    return found


def _find_attachment(attachments: list[Attachment], path: str) -> str | None:
    """The attachment ``path`` names, ignoring case, else by bare file name (as the editor)."""
    lower = path.replace("\\", "/").lower()
    for a in attachments:
        if a["path"].lower() == lower:
            return a["path"]
    if "/" in lower:
        return None
    for a in attachments:
        if a["path"].rsplit("/", 1)[-1].lower() == lower:
            return a["path"]
    return None


def _lookup(root: Path, candidate: str, cache: dict) -> str | None:
    """The servable file ``candidate`` names (space-relative), or None. ``cache`` holds the
    attachment list once it was needed."""
    try:
        full = attachment_path(root, candidate)
    except FileNotFoundError:
        if "attachments" not in cache:
            cache["attachments"] = list_attachments(root)
        found = _find_attachment(cache["attachments"], candidate)
        if found is None:
            return None
        try:
            full = attachment_path(root, found)
        except (FileNotFoundError, NotServed, OSError, ValueError):
            return None
    except (NotServed, OSError, ValueError):
        return None
    return full.relative_to(root).as_posix()


def referenced_media(root: Path, rel: str, fm: dict, body: str) -> list[str]:
    """The existing, servable files ``rel`` references, as space-relative POSIX paths."""
    root = Path(root).resolve()
    out: list[str] = []
    cache: dict = {}
    for candidate in _candidates(rel, fm, body):
        real = _lookup(root, candidate, cache)
        if real is not None and real not in out:
            out.append(real)
    return out


def _media_resolver(root: Path, rel: str):
    """``target -> space-relative file or None``, read as `referenced_media` reads a path."""
    root = Path(root).resolve()
    folder = PurePosixPath(rel).parent.as_posix()
    cache: dict = {}

    def resolve(target: str) -> str | None:
        target = unquote(target.strip())
        if not target or _SCHEME_RE.match(target):
            return None
        tries = [target] + ([f"{folder}/{target}"] if folder != "." and not target.startswith("/") else [])
        for t in tries:
            found = _lookup(root, t, cache)
            if found is not None:
                return found
        return None

    return resolve


@dataclass(frozen=True)
class ExportOptions:
    """The dialog's choices (`entity.settings.export.options.*`, `typesetPdf.mode.*`).

    Markdown: ``subpages`` ("Include subpages (as a folder)"), ``media``, ``title_h1``
    ("Add the title as a top heading") and ``wikilinks`` ("Links as wikilinks"; on by default,
    our choice, so the default export is the file's own bytes). PDF: ``style``, ``paper``,
    ``embedded``, ``outline``, ``hide_empty`` (on by default), ``type_labels``
    and ``hidden`` (deselected property keys). Word and LaTeX use the property choices.
    """

    format: str = "md"
    media: bool = False
    subpages: bool = False
    title_h1: bool = False
    wikilinks: bool = True
    style: str = "notes"
    paper: str = "A4"
    embedded: bool = True
    outline: bool = False
    hide_empty: bool = True
    type_labels: bool = False
    hidden: frozenset[str] = field(default_factory=frozenset)


FORMATS = ("md", "html", "docx", "latex")
_DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_FM_RE = re.compile(r"^---[ \t]*\r?\n(?:.*?\r?\n)?---[ \t]*(?:\r?\n|$)", re.S)
_WIKI_PARTS = re.compile(r"^!?\[\[([^\[\]|#\n]+)(#[^\[\]|\n]*)?(?:\|([^\[\]\n]*))?\]\]$")
_DATA_VIEW = re.compile(r"^(collection|query):")
_NOT_EXPORTED = {"entity_title", "entity_icon", "entity_backlinks"}


def _title(raw, rel: str) -> str:
    t = raw.fm.get("title")
    return t.strip() if isinstance(t, str) and t.strip() else PurePosixPath(rel).stem


def _is_object_target(target: str) -> bool:
    ext = PurePosixPath(target).suffix.lower()
    return not _DATA_VIEW.match(target) and (ext in ("", ".md") or len(ext) > 9)


def _subpages(space: Space, rel: str) -> list[str]:
    """The objects ``rel`` embeds (``![[Object]]``), and theirs in turn, in order (our
    reading of "linked subpages": embedded objects, followed to any depth)."""
    out: list[str] = []
    seen = {rel}
    queue = [rel]
    while queue:
        cur = queue.pop(0)
        try:
            body = read_raw(space.root, cur).of.body
        except (OSError, ValueError):
            continue
        for target, start, _end in wikilink_spans(body):
            if not body.startswith("!", start) or not _is_object_target(target):
                continue
            found = space.resolve(target.strip(), cur)
            if found and found not in seen and (space.root / found).is_file():
                seen.add(found)
                out.append(found)
                queue.append(found)
    return out


def _markdown(
    space: Space, rel: str, opts: ExportOptions, zip_path: str, placed: dict[str, str] | None = None
) -> bytes:
    """The ``.md`` of ``rel`` with the Markdown options applied; its own bytes by default.

    ``zip_path`` is where the file lands in the export, which relative links start from;
    ``placed`` maps a space path to where it lands when that is not its own path.
    BOM, newlines and frontmatter are kept as they are.
    """
    data = (space.root / rel).read_bytes()
    synced = _synced_lines(space, rel)
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
        body = _paths_for_wikilinks(space, rel, body, PurePosixPath(zip_path).parent.as_posix(), placed)
    if opts.title_h1:
        title = _title(read_raw(space.root, rel), rel)
        first = body.lstrip("\r\n").split("\n", 1)[0].rstrip("\r")
        if first.strip() != f"# {title}":
            body = f"# {title}{nl}{nl}" + body.lstrip("\r\n")
    out = (head + body).encode("utf-8", "surrogateescape")
    return (b"\xef\xbb\xbf" if bom else b"") + out


def _synced_lines(space: Space, rel: str) -> tuple[dict[str, Any], list[str]] | None:
    """M29: the synced values the exported copy's front matter gets (``sets``) and the synced
    keys it drops (``drops``: a hand-typed value the store doesn't hold), or None when the
    object's type has no synced properties or the copy would not change."""
    raw = read_raw(space.root, rel)
    tdef = _type_of(space, raw)
    props = synced_props(tdef)
    if not props:
        return None
    fm = space.synced.overlay(tdef, raw.fm)
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


def _with_synced(head: str, nl: str, sets: dict[str, Any], drops: list[str]) -> str:
    """The front matter block ``head`` (fences included, newlines ``nl``) with the synced
    values set and the dropped keys removed; ``head`` as it was if it can't be edited."""
    of = split_object(head.replace("\r\n", "\n"))
    if of.frontmatter_src is None:
        return head
    try:
        src = set_keys(of.frontmatter_src, sets) if sets else of.frontmatter_src
        src = delete_keys(src, drops)
    except FrontmatterError:
        return head
    out = join_object(replace(of, frontmatter_src=src))
    return out.replace("\n", nl) if nl != "\n" else out


def _paths_for_wikilinks(
    space: Space, rel: str, body: str, from_folder: str, placed: dict[str, str] | None = None
) -> str:
    """``[[Title]]`` as ``[Title](path)`` ("Export links as [[title]] instead of [title](path)").

    The path is relative to ``from_folder`` and URL-encoded; an embedded file stays an image or
    link to its file; a link that resolves to nothing becomes its text (our choice).
    """
    media = _media_resolver(space.root, rel)

    def rel_url(target_rel: str) -> str:
        p = posixpath.relpath(target_rel, from_folder or ".")
        return quote(p, safe="/")

    parts: list[str] = []
    last = 0
    for target, start, end in wikilink_spans(body):
        m = _WIKI_PARTS.match(body[start:end])
        if m is None:
            continue
        embed = body.startswith("!", start)
        target = target.strip()
        label = (m.group(3) or "").strip()
        if _DATA_VIEW.match(target):
            continue
        if _is_object_target(target):
            found = space.resolve(target, rel)
            text = label or target.rsplit("/", 1)[-1].removesuffix(".md")
            new = f"[{text}]({rel_url((placed or {}).get(found, found))})" if found else text
        else:
            found = media(target)
            text = label or (target.rsplit("/", 1)[-1] if not embed else "")
            new = f"{'!' if embed else ''}[{text}]({rel_url(found)})" if found else (label or target)
        parts.append(body[last:start])
        parts.append(new)
        last = end
    parts.append(body[last:])
    return "".join(parts)


def _write_zip(space: Space, rel: str, stem: str, out, opts: ExportOptions | None = None) -> None:
    """The zip of ``rel`` into the binary file object ``out`` (attachments streamed): its
    ``.md`` at the top, with subpages at their space-relative paths and, with ``media``,
    every file they reference."""
    opts = opts or ExportOptions(media=True)
    subpages = _subpages(space, rel) if opts.subpages else []
    # The root sits at the top, unless a subpage already has that name: then at its own path.
    main = f"{stem}.md" if f"{stem}.md" not in subpages else rel
    files = [(rel, main)] + [(p, p) for p in subpages]
    placed = {rel: main}
    written: set[str] = set()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, strict_timestamps=False) as zf:
        for src, dest in files:
            if dest in written:
                continue
            written.add(dest)
            zf.writestr(dest, _markdown(space, src, opts, dest, placed))
        if not opts.media:
            return
        for src, _dest in files:
            raw = read_raw(space.root, src)
            for item in referenced_media(space.root, src, raw.fm, raw.of.body):
                if item in written:
                    continue
                written.add(item)
                try:
                    zf.write(space.root / item, item)
                except OSError:
                    continue  # gone or unreadable since it was found: skipped like a missing one


def _object_rel(space: Space, path: str) -> str:
    rel = space._rel(path)
    if not (space.root / rel).is_file():
        raise KeyError(rel)
    return rel


def _type_of(space: Space, raw) -> TypeDefinition | None:
    return next((t for t in space.types if t.name == raw.typeName), None)


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


_ISO_RE = re.compile(r"^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?$")


def _value_text(value: Any) -> str:
    """A property value as one line of Markdown (links stay ``[[...]]`` for the renderers)."""
    if isinstance(value, bool):
        return "Yes" if value else "No"  # our string
    if isinstance(value, list):
        return ", ".join(t for t in (_value_text(v) for v in value) if t)
    if isinstance(value, dict):
        return ", ".join(f"{k}: {_value_text(v)}" for k, v in value.items() if not _is_empty(v))
    text = str(value)
    m = _ISO_RE.match(text)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return text.replace("\r\n", " ").replace("\n", " ")


def export_properties(space: Space, path: str) -> list[dict[str, Any]]:
    """The properties the dialog's "Properties" list offers: ``{key, name, empty}`` in the
    type's order (title, icon and backlinks are the page itself, not properties)."""
    rel = _object_rel(space, path)
    raw = read_raw(space.root, rel)
    tdef = _type_of(space, raw)
    if tdef is None:
        return []
    fm = space.synced.overlay(tdef, raw.fm)  # M29: synced facts, not a hand-typed value
    return [
        {"key": p.key, "name": p.name, "empty": _is_empty(fm.get(p.key))}
        for p in tdef.propertyDefinitions
        if p.type not in _NOT_EXPORTED
    ]


def build_doc(space: Space, rel: str, opts: ExportOptions) -> Doc:
    """The object at ``rel`` as an `exportdoc.Doc` (title, type, shown properties, blocks)."""
    raw = read_raw(space.root, rel)
    tdef = _type_of(space, raw)
    fm = space.synced.overlay(tdef, raw.fm)  # M29: synced facts, not a hand-typed value
    props: list[tuple[str, str]] = []
    for p in tdef.propertyDefinitions if tdef else []:
        if p.type in _NOT_EXPORTED or p.key in opts.hidden:
            continue
        value = fm.get(p.key)
        if opts.hide_empty and _is_empty(value):
            continue
        if _is_empty(value):
            text = ""
        elif p.type == TABLE_KIND:  # M31: "Name, Qty; Apple, 3"
            text = table_one_line(decode_value(p, value))
        else:
            text = _value_text(value)
        props.append((p.name, text))
    blocks = parse_blocks(raw.of.body, _media_resolver(space.root, rel))
    for b in blocks:
        if b.kind != "embed" or not opts.embedded:
            continue
        found = space.resolve(b.src, rel)
        if not found or found == rel or not (space.root / found).is_file():
            continue
        child = read_raw(space.root, found)
        b.title = _title(child, found) if not b.title or b.title == b.src else b.title
        # One level: an embed inside the embedded object shows as its title (our choice).
        b.children = parse_blocks(child.of.body, _media_resolver(space.root, found))
    return Doc(_title(raw, rel), raw.typeName if tdef else "", props, blocks)


def export_object(space: Space, path: str, media: bool, options: ExportOptions | None = None) -> Export:
    """The export of the object at ``path``, in memory. Writes nothing.

    Raises `ValueError` (not an object path or an unknown format, 400) and `KeyError`
    (no such file, 404). The route uses `export_object_to_file`, which never holds a zip
    in memory.
    """
    opts = options or ExportOptions(media=media)
    if opts.format not in FORMATS:
        raise ValueError(f"Unknown export format {opts.format!r}")
    rel = _object_rel(space, path)
    stem = PurePosixPath(rel).stem
    if opts.format == "html":
        tdef = _type_of(space, read_raw(space.root, rel))
        page = render_html(
            build_doc(space, rel, opts),
            style=opts.style,
            paper=opts.paper,
            outline=opts.outline,
            type_label=opts.type_labels,
            font=tdef.font if tdef else "sans-serif",
        )
        return Export(page.encode("utf-8"), f"{stem}.html", "text/html; charset=utf-8")
    if opts.format == "docx":
        data = render_docx(build_doc(space, rel, opts), type_label=opts.type_labels)
        return Export(data, f"{stem}.docx", _DOCX_TYPE)
    if opts.format == "latex":
        tex = render_latex(build_doc(space, rel, opts), type_label=opts.type_labels)
        return Export(tex.encode("utf-8"), f"{stem}.tex", "application/x-tex; charset=utf-8")
    if not (opts.media or opts.subpages):
        return Export(_markdown(space, rel, opts, f"{stem}.md"), f"{stem}.md", "text/markdown; charset=utf-8")
    buf = io.BytesIO()
    _write_zip(space, rel, stem, buf, opts)
    return Export(buf.getvalue(), f"{stem}.zip", "application/zip")


def export_object_to_file(
    space: Space, path: str, media: bool, options: ExportOptions | None = None
) -> Export:
    """The export of the object at ``path``; a zip as a temporary ``file``.

    A single file (``.md``, ``.html``, ``.docx``, ``.tex``) is ``data``, as `export_object`.
    A zip (media or subpages) is written to a new file in `export_dir` and returned as
    ``Export.file`` (``data`` empty): the caller sends that file and then calls
    `Export.cleanup`. Writes nothing in the space. Raises as `export_object`.
    """
    opts = options or ExportOptions(media=media)
    if opts.format != "md" or not (opts.media or opts.subpages):
        return export_object(space, path, opts.media, opts)
    rel = _object_rel(space, path)
    stem = PurePosixPath(rel).stem
    folder = export_dir()
    folder.mkdir(parents=True, exist_ok=True)
    _sweep(folder, time.time())
    fd, name = tempfile.mkstemp(prefix="export-", suffix=".zip", dir=folder)
    out = Export(b"", f"{stem}.zip", "application/zip", file=Path(name))
    try:
        with os.fdopen(fd, "wb") as f:
            _write_zip(space, rel, stem, f, opts)
    except BaseException:
        out.cleanup()
        raise
    return out


def content_disposition(filename: str) -> str:
    """An ``attachment`` header naming ``filename`` (RFC 6266, with an ASCII fallback)."""
    if filename.isascii() and filename.isprintable() and not re.search(r'["\\]', filename):
        return f'attachment; filename="{filename}"'
    fallback = "".join(
        c if c.isascii() and c.isprintable() and c not in '"\\' else "_" for c in filename
    )
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
