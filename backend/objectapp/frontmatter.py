"""Read and minimally edit YAML frontmatter source.

`parse_fm` turns frontmatter source into plain Python values (``dict``,
``list``, ``str``, ``int``, ``float``, ``bool``, ``None``). Timestamps and dates
stay strings exactly as written, so ``2026-03-26T00:00:00.000Z`` reads back as
that string rather than a ``datetime``.

`set_keys` changes only the lines of the keys it is given. It uses ruamel.yaml
(round-trip mode) to locate each top-level key and to render the new value,
then splices lines; every other line of the source is kept byte-for-byte,
including quotes, ``null``, folded scalars, flow lists and comments.

Both work on text normalised to ``\\n`` line endings (see `textfile`).
"""

from __future__ import annotations

import io
import re
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.constructor import SafeConstructor
from ruamel.yaml.error import YAMLError
from ruamel.yaml.scalarstring import (
    DoubleQuotedScalarString,
    SingleQuotedScalarString,
)

__all__ = ["FrontmatterError", "parse_fm", "set_keys"]

# Strings that a YAML 1.1/1.2 resolver would read as a timestamp. The export
# writes them unquoted, so we do too.
_TIMESTAMP_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}"
    r"(?:[Tt ]\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:[ \t]*(?:Z|[+-]\d{1,2}(?::?\d{2})?))?)?"
)


class FrontmatterError(ValueError):
    """The frontmatter source is not valid YAML or is not a mapping."""


class _PlainConstructor(SafeConstructor):
    """Safe constructor that keeps timestamps as their source text."""


_PlainConstructor.add_constructor(
    "tag:yaml.org,2002:timestamp",
    lambda self, node: self.construct_scalar(node),
)


def _plain_yaml() -> YAML:
    y = YAML(typ="safe", pure=True)
    y.Constructor = _PlainConstructor
    return y


def _rt_yaml() -> YAML:
    y = YAML(typ="rt")
    y.preserve_quotes = True
    y.width = 4096
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def _plain(value: Any) -> Any:
    if isinstance(value, dict):
        return {_plain(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, str):
        return str(value)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    return value


def parse_fm(src: str) -> dict:
    """Parse frontmatter source into plain Python values.

    Raises `FrontmatterError` when the YAML is invalid (duplicate keys
    included) or is not a mapping.
    Empty (or comment-only) source parses to ``{}``.
    """
    try:
        data = _plain_yaml().load(src)
    except YAMLError as exc:
        raise FrontmatterError(str(exc)) from exc
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise FrontmatterError(f"Frontmatter is a {type(data).__name__}, not a mapping")
    return _plain(data)


def _load_rt(src: str) -> CommentedMap | None:
    try:
        data = _rt_yaml().load(src)
    except YAMLError as exc:
        raise FrontmatterError(str(exc)) from exc
    if data is None:
        return None
    if not isinstance(data, CommentedMap):
        raise FrontmatterError(f"Frontmatter is a {type(data).__name__}, not a mapping")
    return data


def _styled_like(old: Any, new: Any) -> Any:
    """Carry the old value's quote or flow style over to a new value."""
    if isinstance(new, str) and not isinstance(
        new, (SingleQuotedScalarString, DoubleQuotedScalarString)
    ):
        if isinstance(old, SingleQuotedScalarString):
            return SingleQuotedScalarString(new)
        if isinstance(old, DoubleQuotedScalarString):
            return DoubleQuotedScalarString(new)
    if isinstance(new, (list, tuple)) and not isinstance(new, CommentedSeq):
        seq = CommentedSeq(new)
        if isinstance(old, CommentedSeq) and old.fa.flow_style():
            seq.fa.set_flow_style()
        return seq
    return new


def _render(key: Any, value: Any) -> list[str]:
    """Render ``key: value`` as frontmatter lines, each ending in ``\\n``."""
    if isinstance(key, str) and isinstance(value, str) and type(value) is str:
        if _TIMESTAMP_RE.fullmatch(value) and _rt_yaml_key_plain(key):
            return [f"{key}: {value}\n"]
    buf = io.StringIO()
    _rt_yaml().dump(CommentedMap([(key, value)]), buf)
    text = buf.getvalue()
    if text.endswith("...\n"):  # document end marker after a bare scalar
        text = text[: -len("...\n")]
    return text.splitlines(keepends=True)


def _rt_yaml_key_plain(key: str) -> bool:
    return re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.\-]*", key) is not None


def _is_filler(line: str) -> bool:
    stripped = line.strip()
    return stripped == "" or (line.startswith("#"))


def set_keys(
    src: str,
    updates: dict[str, Any],
    insert_first: dict[str, Any] | None = None,
) -> str:
    """Set top-level keys in frontmatter source, changing nothing else.

    Keys already in ``src`` are replaced in place (only their own lines).
    Keys from ``updates`` that are absent are appended at the end; absent keys
    from ``insert_first`` go at the very top, in the order given.
    Raises `FrontmatterError` when ``src`` is not a valid YAML mapping.
    """
    insert_first = insert_first or {}
    if not updates and not insert_first:
        return src

    data = _load_rt(src)
    lines = src.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"

    if data is not None and data.fa.flow_style():
        # A whole-mapping flow style (`{a: 1}`) has no per-key lines to splice.
        for k, v in {**updates, **insert_first}.items():
            data[k] = _styled_like(data.get(k), v)
        buf = io.StringIO()
        _rt_yaml().dump(data, buf)
        return buf.getvalue()

    existing = list(data.keys()) if data is not None else []
    starts = sorted((data.lc.key(k)[0], k) for k in existing) if data is not None else []

    # Line range [start, end) of each existing key, trailing blank/comment lines excluded.
    spans: dict[Any, tuple[int, int]] = {}
    for i, (start, k) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(lines)
        while end > start + 1 and _is_filler(lines[end - 1]):
            end -= 1
        spans[k] = (start, end)

    replacements: dict[int, tuple[int, list[str]]] = {}
    appended: list[str] = []
    prepended: list[str] = []

    for group, target in ((insert_first, prepended), (updates, appended)):
        for k, v in group.items():
            if k in spans:
                start, end = spans[k]
                replacements[start] = (end, _render(k, _styled_like(data[k], v)))
            else:
                target.extend(_render(k, v))

    out: list[str] = list(prepended)
    i = 0
    while i < len(lines):
        if i in replacements:
            end, new_lines = replacements[i]
            out.extend(new_lines)
            i = end
        else:
            out.append(lines[i])
            i += 1
    out.extend(appended)
    return "".join(out)
