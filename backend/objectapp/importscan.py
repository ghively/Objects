"""M26: the local sensitive-content scan that runs before any agent reads an import (design section 6).

No AI, no network, reads only. A finding names the *kind* and the *line*, never the matched value;
nothing here keeps a matched string beyond the test that made it. "Leave out" folders and patterns
are never opened. Documents (docx, xlsx, pptx, pdf, html) are scanned through their readable text,
so a line is a line of the page the importer would write; plain text and unknown text-like files
(``.env``, ``.json``, ``.yml``...) are scanned as they are.

The scan reads the same files the import's source lister (`importers.source`) reads: a zip at the
top level of the source (Notion's multi-part export, a ``part.zip`` at the top of a folder) is
opened one level deep, a zip deeper than that is counted as unscanned, and a zip source whose
every entry sits under one folder is read as that folder.
"""

from __future__ import annotations

import fnmatch
import os
import re
import stat
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from . import readers

__all__ = ["Finding", "KINDS", "MAX_SCAN_BYTES", "ScanReport", "scan_file", "scan_text", "scan_tree"]

MAX_SCAN_BYTES = 50 * 1024 * 1024
KINDS = ("private-key", "api-key", "password", "connection-string", "card-number")

_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("private-key", re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----")),
    (
        "api-key",
        re.compile(
            r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"  # AWS access key id
            r"|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b"  # GitHub
            r"|\bxox[abprs]-[A-Za-z0-9-]{10,}"  # Slack
            r"|\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b"  # Stripe
            r"|\bAIza[0-9A-Za-z_-]{35}\b"  # Google
            r"|\bsk-ant-[A-Za-z0-9_-]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}"  # Anthropic, OpenAI
            r"|\bnpm_[A-Za-z0-9]{36}\b|\bglpat-[A-Za-z0-9_-]{20}\b|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}"
            r"|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"  # JWT
            r"|(?i:\bBearer\s+)[A-Za-z0-9._~+/-]{30,}=*"
        ),
    ),
    (
        "password",
        re.compile(
            r"(?i)(?<![A-Za-z0-9])(?:password|passwd|pwd|passphrase|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)"
            r"[\"']?\s*(?:[:=]|:=|=>)\s*[\"']?(?!\s*[\"']?\s*$)(?![<{$%\[(*]|your[_-]|example|changeme|xxx|null\b|none\b|true\b|false\b|redacted|\.\.\.)"
            r"[^\s\"',;]{4,}"
        ),
    ),
    (
        "connection-string",
        re.compile(
            r"(?i)\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver|oracle)://[^\s/:@]+:[^\s/@]+@\S+"
            r"|(?i:\b(?:Server|Data Source)=[^;\n]+;[^\n]*?(?:Password|Pwd)=[^;\s][^;\n]*)"
            r"|(?i:DefaultEndpointsProtocol=https?;[^\n]*AccountKey=[A-Za-z0-9+/=]{20,})"
        ),
    ),
]
_CARD = re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])")


def luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


@dataclass(frozen=True)
class Finding:
    kind: str
    line: int  # 1-based

    def to_json(self) -> dict:
        return {"kind": self.kind, "line": self.line}


def scan_text(text: str) -> list[Finding]:
    """Findings (kind and line only) in ``text``, in line order; one per kind per line."""
    out: list[Finding] = []
    for n, line in enumerate(text.splitlines(), 1):
        seen: set[str] = set()
        # A very long line is scanned in overlapping chunks, never cut short.
        for start in range(0, max(len(line), 1), CHUNK - OVERLAP):
            _scan_line(line[start : start + CHUNK], seen)
            if start + CHUNK >= len(line):
                break
        out += [Finding(k, n) for k in KINDS if k in seen]
    return out


CHUNK = 20000
OVERLAP = 1000


def _scan_line(line: str, seen: set[str]) -> None:
    for kind, rx in _PATTERNS:
        if rx.search(line):
            seen.add(kind)
    for m in _CARD.finditer(line):
        digits = re.sub(r"\D", "", m.group())
        if 13 <= len(digits) <= 19 and luhn(digits) and len(set(digits)) > 1:
            seen.add("card-number")
            break


def _text_of(path: Path) -> str | None:
    """The text to scan, or None when the file has no text to look at."""
    if not stat.S_ISREG(os.stat(path).st_mode):
        return None  # a FIFO, socket or device: opening it can block forever
    suffix = path.suffix.lower()
    if suffix in readers.supported_suffixes():
        r = readers.read_file(path)
        return None if r.original_only else r.markdown
    with open(path, "rb") as f:
        head = f.read(8192)
    if b"\x00" in head:
        return None
    from .readers.textfiles import decode

    return decode(path.read_bytes())


def scan_file(path: Path) -> list[Finding]:
    """Scan one file. Reads only; an unreadable, binary or over-size file has no findings."""
    path = Path(path)
    try:
        if path.stat().st_size > MAX_SCAN_BYTES:
            return []
        text = _text_of(path)
    except Exception:
        return []
    return scan_text(text) if text else []


def is_left_out(rel: str, patterns: list[str]) -> bool:
    """Whether ``rel`` (posix, relative) matches a "Leave out" folder or pattern (case-insensitive).

    A pattern matches the whole path, the file name, any folder name on the way, or a leading folder path.
    """
    parts = PurePosixPath(rel).parts
    low = rel.lower()
    for raw in patterns:
        p = raw.strip().replace("\\", "/").strip("/").lower()
        if not p:
            continue
        if fnmatch.fnmatchcase(low, p) or any(fnmatch.fnmatchcase(x.lower(), p) for x in parts):
            return True
        if any(fnmatch.fnmatchcase("/".join(parts[:i]).lower(), p) for i in range(1, len(parts) + 1)):
            return True
    return False


@dataclass
class ScanReport:
    findings: dict[str, list[Finding]] = field(default_factory=dict)  # relative path -> findings
    left_out: list[str] = field(default_factory=list)  # relative paths never read
    scanned: int = 0
    unscanned: int = 0  # binary, over-size or too deeply nested files with no text to look at

    @property
    def counts(self) -> dict[str, int]:
        return {
            "scanned": self.scanned,
            "unscanned": self.unscanned,
            "flagged": len(self.findings),
            "findings": sum(len(v) for v in self.findings.values()),
            "leftOut": len(self.left_out),
        }

    def to_json(self) -> dict:
        return {
            "findings": {p: [f.to_json() for f in fs] for p, fs in self.findings.items()},
            "leftOut": self.left_out,
            "counts": self.counts,
            # the wizard's per-file choice defaults to this for every flagged file (design section 6)
            "defaultChoice": "excludeFromAi",
        }


def scan_tree(root: Path, leave_out: list[str] | None = None) -> ScanReport:
    """Scan every file under ``root`` (or the one file ``root``); "Leave out" matches are not opened."""
    root = Path(root)
    patterns = list(leave_out or [])
    report = ScanReport()
    if root.is_file():
        if root.suffix.lower() == ".zip":
            return _scan_zip(root, patterns, report, as_source=True)
        text = None if root.stat().st_size > MAX_SCAN_BYTES else _text_or_none(root)
        if text is None:
            report.unscanned = 1
            return report
        report.scanned = 1
        found = scan_text(text)
        if found:
            report.findings[root.name] = found
        return report
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            p = Path(dirpath) / name
            rel = p.relative_to(root).as_posix()
            if is_left_out(rel, patterns):
                report.left_out.append(rel)
                continue
            try:
                st = p.lstat()
                if not stat.S_ISREG(st.st_mode):
                    continue  # a symlink, FIFO, socket or device is never opened (nor imported)
                too_big = st.st_size > MAX_SCAN_BYTES
            except OSError:
                report.unscanned += 1
                continue
            if rel.lower().endswith(".zip") and "/" not in rel:
                # The lister reads a zip at the top of a folder as part of the source, one level
                # deep (its own nested zips are never imported): so does the scan.
                _scan_zip(p, patterns, report, as_source=False)
                continue
            text = None if too_big else _text_or_none(p)
            if text is None:
                report.unscanned += 1
                continue
            report.scanned += 1
            found = scan_text(text)
            if found:
                report.findings[rel] = found
    return report


def _text_or_none(p: Path) -> str | None:
    try:
        return _text_of(p)
    except Exception:
        return None


MAX_ZIP_MEMBER_BYTES = 20 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 500 * 1024 * 1024
MAX_NESTED_ZIP_BYTES = 256 * 1024 * 1024
"""A zip at the top level of a zip source is read into memory up to this (the lister's
`NESTED_IN_MEMORY`); a bigger one is counted as unscanned."""


def _safe_member(name: str) -> bool:
    parts = PurePosixPath(name.replace("\\", "/")).parts
    return bool(parts) and not name.startswith(("/", "\\")) and ".." not in parts and ":" not in parts[0] and "\x00" not in name


def _single_top(names: list[str]) -> str:
    """The one folder every (non-``__MACOSX``) entry sits under, or ``""`` (the lister's rule: a zip
    whose every entry sits under one folder is read as that folder)."""
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


def _scan_zip(path: Path, patterns: list[str], report: ScanReport, *, as_source: bool) -> ScanReport:
    """Scan the members of a zip: safe names only, text-like members by their text, documents through
    their readable text (a temporary copy), each capped in size. What can't be scanned (an unsafe name,
    an encrypted, too deeply nested or over-size member, a binary file) is counted as unscanned, never
    as clean.

    ``as_source`` says the zip is the source itself: a single top folder is stripped from its member
    names and a zip at its top level is opened one level deep, as the lister reads it. A zip at the
    top of a folder source (``as_source`` False) is read as part of the folder: its members by their
    own names, its own nested zips unscanned."""
    import tempfile
    import zipfile

    try:
        if not stat.S_ISREG(os.stat(path).st_mode):
            report.unscanned += 1
            return report
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        report.unscanned += 1
        return report
    with zf, tempfile.TemporaryDirectory() as tmp:
        _scan_zip_members(zf, patterns, report, Path(tmp), [0], strip_top=as_source, nested=as_source)
    return report


def _scan_zip_members(zf, patterns: list[str], report: ScanReport, tmp: Path, total: list[int], *,
                      strip_top: bool, nested: bool) -> None:
    """Scan the members of the open zip ``zf``; ``total[0]`` is the running byte total across the
    source and its nested zips. With ``nested``, a safe ``.zip`` at the top level is opened (in
    memory, within `MAX_NESTED_ZIP_BYTES`) and its members scanned by their own names."""
    import io
    import zipfile

    members: list[tuple[str, zipfile.ZipInfo]] = []
    for info in zf.infolist():
        if info.is_dir():
            continue
        name = info.filename
        if not _safe_member(name):
            report.unscanned += 1
            continue
        members.append((PurePosixPath(name.replace("\\", "/")).as_posix(), info))
    top = _single_top([rel for rel, _ in members]) if strip_top else ""
    for rel, info in members:
        if top and rel.startswith(top):
            rel = rel[len(top):]
        if is_left_out(rel, patterns):
            report.left_out.append(rel)
            continue
        total[0] += info.file_size
        encrypted = bool(info.flag_bits & 0x1)
        if rel.lower().endswith(".zip"):
            if not nested or "/" in rel or encrypted or info.file_size > MAX_NESTED_ZIP_BYTES \
                    or total[0] > MAX_ZIP_TOTAL_BYTES:
                report.unscanned += 1
                continue
            try:
                inner = zipfile.ZipFile(io.BytesIO(zf.read(info)))
            except Exception:  # noqa: BLE001 - a damaged nested zip is unscanned (the lister skips it)
                report.unscanned += 1
                continue
            with inner:
                _scan_zip_members(inner, patterns, report, tmp, total, strip_top=False, nested=False)
            continue
        if encrypted or info.file_size > MAX_ZIP_MEMBER_BYTES or total[0] > MAX_ZIP_TOTAL_BYTES:
            report.unscanned += 1
            continue
        try:
            data = zf.read(info)
            text = _member_text(rel, data, tmp)
        except Exception:  # noqa: BLE001 - a damaged member is unscanned
            text = None
        if text is None:
            report.unscanned += 1
            continue
        report.scanned += 1
        found = scan_text(text)
        if found:
            report.findings.setdefault(rel, []).extend(found)


def _member_text(rel: str, data: bytes, tmp: Path) -> str | None:
    suffix = PurePosixPath(rel).suffix.lower()
    if suffix in readers.supported_suffixes():
        copy = tmp / f"member{suffix}"
        copy.write_bytes(data)
        r = readers.read_file(copy)
        copy.unlink()
        return None if r.original_only else r.markdown
    if b"\x00" in data[:8192]:
        return None
    from .readers.textfiles import decode

    return decode(data)
