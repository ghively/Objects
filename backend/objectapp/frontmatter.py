"""Read and minimally edit YAML frontmatter source.

`parse_fm` turns frontmatter source into plain Python values (``dict``,
``list``, ``str``, ``int``, ``float``, ``bool``, ``None``). Timestamps and dates
stay strings exactly as written, so ``2026-03-26T00:00:00.000Z`` reads back as
that string rather than a ``datetime``.

`set_keys` changes only the lines of the keys it is given; `delete_keys`,
`rename_key`, `replace_in_value` and `remove_items` likewise touch only their
key's lines (the last two only the items they change or drop).
They use ruamel.yaml (round-trip mode) to locate each top-level key and to
render new values, then splice lines; every other line of the source is kept
byte-for-byte, including quotes, ``null``, folded scalars, flow lists and
comments.

All of them work on text normalised to ``\\n`` line endings (see `textfile`).
"""

from __future__ import annotations

import io
import json
import re
from collections.abc import Callable, Iterable
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.constructor import ConstructorError, SafeConstructor
from ruamel.yaml.error import YAMLError
from ruamel.yaml.nodes import MappingNode
from ruamel.yaml.scalarstring import (
    DoubleQuotedScalarString,
    LiteralScalarString,
    ScalarString,
    SingleQuotedScalarString,
)

__all__ = [
    "FlowList",
    "FrontmatterError",
    "delete_keys",
    "insert_in_list",
    "parse_fm",
    "remove_from_list",
    "remove_items",
    "rename_key",
    "replace_in_value",
    "set_keys",
]

# Strings that a YAML 1.1/1.2 resolver would read as a timestamp. The export
# writes them unquoted, so we do too.
_TIMESTAMP_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}"
    r"(?:[Tt ]\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:[ \t]*(?:Z|[+-]\d{1,2}(?::?\d{2})?))?)?"
)


class FrontmatterError(ValueError):
    """The frontmatter source is not valid YAML or is not a mapping."""


class FlowList(list):
    """A list value for `set_keys` that is written as a flow list (``[a, b]``).

    A key that already holds a block list keeps the block form.
    """


_MERGE_TAG = "tag:yaml.org,2002:merge"
_MERGE_MESSAGE = "Frontmatter uses a merge key (<<), which can't be edited in place"


def _has_top_level_merge(node: Any) -> bool:
    return isinstance(node, MappingNode) and any(k.tag == _MERGE_TAG for k, _v in node.value)


class _PlainConstructor(SafeConstructor):
    """Safe constructor that keeps timestamps as their source text.

    A merge key at the top level (``<<: *anchor``) is refused: the merged-in keys
    have no lines of their own, so none of the line-splicing edits below could
    work on the file (the round-trip loader reports the same via ``data.merge``).
    """

    def construct_document(self, node: Any) -> Any:
        if _has_top_level_merge(node):
            raise ConstructorError(None, None, _MERGE_MESSAGE, node.start_mark)
        return super().construct_document(node)


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
    except RecursionError as exc:
        # ruamel's composer recurses per nesting level: `[[[[…` 500 deep is a bad file,
        # not a crash of the whole space.
        raise FrontmatterError("Frontmatter is nested too deeply") from exc
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
    except RecursionError as exc:
        raise FrontmatterError("Frontmatter is nested too deeply") from exc
    if data is None:
        return None
    if not isinstance(data, CommentedMap):
        raise FrontmatterError(f"Frontmatter is a {type(data).__name__}, not a mapping")
    if data.merge:
        raise FrontmatterError(_MERGE_MESSAGE)
    return data


def _styled_like(old: Any, new: Any) -> Any:
    """Carry the old value's quote or flow style over to a new value.

    A new value that already has an explicit style (any ruamel `ScalarString`,
    such as a literal block) keeps it.
    """
    if isinstance(new, str) and not isinstance(new, ScalarString):
        if isinstance(old, LiteralScalarString) and _literal_safe(new):
            return LiteralScalarString(new)
        if isinstance(old, SingleQuotedScalarString):
            return SingleQuotedScalarString(new)
        if isinstance(old, DoubleQuotedScalarString):
            return DoubleQuotedScalarString(new)
    if isinstance(new, (list, tuple)) and not isinstance(new, CommentedSeq):
        seq = CommentedSeq(new)
        old_is_seq = isinstance(old, CommentedSeq)
        if isinstance(new, FlowList):
            if not (old_is_seq and not old.fa.flow_style()):
                seq.fa.set_flow_style()
        elif old_is_seq and old.fa.flow_style():
            seq.fa.set_flow_style()
        return seq
    return new


def _literal_safe(text: str) -> bool:
    """Whether ``text`` round-trips as a literal block (``|-``) unchanged.

    A literal block can't hold a carriage return, a line ending in whitespace,
    a leading blank or indented first line, or a trailing newline under ``|-``.
    """
    if not text or "\r" in text or text.endswith("\n") or text[0] in " \t\n":
        return False
    return all(line == line.rstrip(" \t") for line in text.split("\n"))


def _render(key: Any, value: Any) -> list[str]:
    """Render ``key: value`` as frontmatter lines, each ending in ``\\n``."""
    if isinstance(key, str) and isinstance(value, str) and type(value) is str:
        if _TIMESTAMP_RE.fullmatch(value) and _rt_yaml_key_plain(key):
            return [f"{key}: {value}\n"]
    if isinstance(value, FlowList):
        value = _styled_like(None, value)
    buf = io.StringIO()
    _rt_yaml().dump(CommentedMap([(key, value)]), buf)
    text = buf.getvalue()
    if text.endswith("...\n"):  # document end marker after a bare scalar
        text = text[: -len("...\n")]
    if value is None and text.endswith(":\n"):
        text = text[:-1] + " null\n"  # ruamel leaves the value empty; we write `null`
    return text.splitlines(keepends=True)


def _rt_yaml_key_plain(key: str) -> bool:
    return re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.\-]*", key) is not None


def _is_filler(line: str) -> bool:
    stripped = line.strip()
    return stripped == "" or (line.startswith("#"))


_LINE_RE = re.compile(r"[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$")


def _lines(src: str) -> list[str]:
    # Split where ruamel counts a line break ("\n", "\r\n", a lone "\r"):
    # `str.splitlines` would also break on U+2028, U+2029, NEL and others
    # inside a value, shifting every later key's line span.
    lines = _LINE_RE.findall(src)
    if lines and not lines[-1].endswith(("\n", "\r")):
        lines[-1] += "\n"
    return lines


def _key_spans(data: CommentedMap | None, lines: list[str]) -> dict[Any, tuple[int, int]]:
    """Line range ``[start, end)`` of each top-level key, trailing blank/comment lines excluded."""
    if data is None:
        return {}
    starts = sorted((data.lc.key(k)[0], k) for k in data.keys())
    spans: dict[Any, tuple[int, int]] = {}
    for i, (start, k) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(lines)
        while end > start + 1 and _is_filler(lines[end - 1]):
            end -= 1
        spans[k] = (start, end)
    return spans


def _dump(data: CommentedMap) -> str:
    buf = io.StringIO()
    _rt_yaml().dump(data, buf)
    return buf.getvalue()


def set_keys(
    src: str,
    updates: dict[str, Any],
    insert_first: dict[str, Any] | None = None,
) -> str:
    """Set top-level keys in frontmatter source, changing nothing else.

    Keys already in ``src`` are replaced in place (only their own lines).
    Keys from ``updates`` that are absent are appended at the end; absent keys
    from ``insert_first`` go at the very top, in the order given. ``None``
    renders as ``null``; a `FlowList` as a flow list.
    Raises `FrontmatterError` when ``src`` is not a valid YAML mapping.
    """
    insert_first = insert_first or {}
    if not updates and not insert_first:
        return src

    data = _load_rt(src)
    lines = _lines(src)

    if data is not None and data.fa.flow_style():
        # A whole-mapping flow style (`{a: 1}`) has no per-key lines to splice.
        for k, v in {**updates, **insert_first}.items():
            data[k] = _styled_like(data.get(k), v)
        return _dump(data)

    spans = _key_spans(data, lines)

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


def delete_keys(src: str, keys: Iterable[str]) -> str:
    """Remove top-level keys (each key's full line span), changing nothing else.

    Absent keys are ignored; with nothing to remove, ``src`` comes back as is.
    Raises `FrontmatterError` when ``src`` is not a valid YAML mapping.
    """
    keys = list(keys)
    if not keys:
        return src
    data = _load_rt(src)
    if data is None or not any(k in data for k in keys):
        return src
    if data.fa.flow_style():
        for k in keys:
            data.pop(k, None)
        return _dump(data) if data else ""
    lines = _lines(src)
    spans = _key_spans(data, lines)
    drop: set[int] = set()
    for k in keys:
        if k in spans:
            drop.update(range(*spans[k]))
    return "".join(line for i, line in enumerate(lines) if i not in drop)


def _key_token_end(line: str, col: int) -> int:
    """Index just past the key token that starts at ``col`` (before its ``:``)."""
    if col < len(line) and line[col] in "'\"":
        q = line[col]
        j = col + 1
        while j < len(line):
            if line[j] == "\\" and q == '"':
                j += 2
                continue
            if line[j] == q:
                if q == "'" and line[j + 1 : j + 2] == "'":
                    j += 2
                    continue
                return j + 1
            j += 1
        return len(line)
    m = re.compile(r":(?=[ \t\r\n]|$)").search(line, col)
    return m.start() if m else len(line)


def _render_key(key: str) -> str:
    if _rt_yaml_key_plain(key):
        return key
    return "'" + key.replace("'", "''") + "'"


def rename_key(src: str, old: str, new: str) -> str:
    """Rename a top-level key in place, keeping its position and its value's bytes.

    An absent ``old`` (or ``old == new``) returns ``src`` unchanged. Raises
    `ValueError` when ``new`` already exists, `FrontmatterError` on invalid YAML.
    """
    if old == new:
        return src
    data = _load_rt(src)
    if data is None or old not in data:
        return src
    if new in data:
        raise ValueError(f"Key {new!r} already exists")
    if data.fa.flow_style():
        out = CommentedMap([(new if k == old else k, v) for k, v in data.items()])
        out.fa.set_flow_style()
        return _dump(out)
    lines = _lines(src)
    row, col = data.lc.key(old)
    line = lines[row]
    lines[row] = line[:col] + _render_key(new) + line[_key_token_end(line, col) :]
    return "".join(lines)


# -- in-place value edits --------------------------------------------------------

# (start, end, style) of one scalar inside a value. style: "'" / '"' / "plain" /
# "flow" (a plain item inside [...]) / "line" (one line of a block scalar).
_ItemSpan = tuple[int, int, str]


def _value_start(lines: list[str], row: int, col: int) -> int:
    """Offset (within ``lines[row]``) just past the ``:`` that follows the key."""
    end = _key_token_end(lines[row], col)
    colon = lines[row].find(":", end)
    return (colon + 1) if colon >= 0 else len(lines[row])


def _scan_block_scalar(text: str, i: int) -> list[_ItemSpan]:
    items: list[_ItemSpan] = []
    n = len(text)
    i = text.find("\n", i)
    if i < 0:
        return items
    i += 1
    while i < n:
        nl = text.find("\n", i)
        nl = n if nl < 0 else nl
        s = i
        while s < nl and text[s] in " \t":
            s += 1
        e = nl
        if e > s and text[e - 1] == "\r":
            e -= 1
        if e > s:
            items.append((s, e, "line"))
        i = nl + 1
    return items


def _quoted_end(text: str, i: int) -> int:
    """Index just past the quoted scalar that opens at ``text[i]``."""
    n, q = len(text), text[i]
    j = i + 1
    while j < n:
        if q == '"' and text[j] == "\\":
            j += 2
            continue
        if text[j] == q:
            if q == "'" and text[j + 1 : j + 2] == "'":
                j += 2
                continue
            return j + 1
        j += 1
    return n


def _scan_items(text: str, i: int) -> list[_ItemSpan]:
    """The scalar items of a value that starts at ``text[i]`` and runs to the end of ``text``."""
    n = len(text)
    while i < n and text[i] in " \t":
        i += 1
    if i < n and text[i] in "|>":
        return _scan_block_scalar(text, i)

    items: list[_ItemSpan] = []
    depth = 0
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
        elif c == "#" and (i == 0 or text[i - 1] in " \t\n"):
            nl = text.find("\n", i)
            i = n if nl < 0 else nl
        elif c == "-" and depth == 0 and (i + 1 == n or text[i + 1] in " \t\r\n"):
            i += 1
        elif c == "[":
            depth += 1
            i += 1
        elif c == "]":
            depth -= 1
            i += 1
        elif c == "," and depth > 0:
            i += 1
        elif c == "{":  # a nested mapping: left alone
            level, j = 0, i
            while j < n:
                if text[j] == "{":
                    level += 1
                elif text[j] == "}":
                    level -= 1
                    if level == 0:
                        break
                j += 1
            i = j + 1
        elif c in "&*!":  # anchors, aliases and tags: left alone
            while i < n and text[i] not in " \t\r\n,]":
                i += 1
        elif c in "'\"":
            j = _quoted_end(text, i)
            items.append((i, j, c))
            i = j
        else:
            j = i
            while j < n and text[j] != "\n":
                if depth > 0 and text[j] in ",]}":
                    break
                if text[j] == "#" and text[j - 1] in " \t":
                    break
                j += 1
            e = j
            while e > i and text[e - 1] in " \t\r":
                e -= 1
            items.append((i, e, "flow" if depth > 0 else "plain"))
            i = j
    return items


def _decode_item(raw: str, style: str) -> str | None:
    if style == "'" and "\n" not in raw:
        return raw[1:-1].replace("''", "'")
    if style in ("'", '"'):  # a multi-line quoted scalar folds its line breaks
        try:
            value = parse_fm(f"x: {raw}\n").get("x")
        except FrontmatterError:
            return None
        return value if isinstance(value, str) else None
    return raw


def _plain_ok(text: str, flow: bool) -> bool:
    """Whether ``text`` reads back as the same string when written as a plain scalar."""
    if not text or "\n" in text or text != text.strip():
        return False
    probe = f"x: [{text}]\n" if flow else f"x: {text}\n"
    try:
        value = parse_fm(probe).get("x")
    except FrontmatterError:
        return False
    if flow:
        return isinstance(value, list) and len(value) == 1 and value[0] == text
    return isinstance(value, str) and value == text


def _encode_item(new: str, style: str, indent: str) -> str:
    if style == "line":
        return new.replace("\n", "\n" + indent)
    if style == "'" and "\n" not in new:
        return "'" + new.replace("'", "''") + "'"
    if style in ("'", '"') or "\n" in new:
        return json.dumps(new, ensure_ascii=False)  # JSON escapes are valid YAML ones
    if _plain_ok(new, flow=(style == "flow")):
        return new
    return "'" + new.replace("'", "''") + "'"


def replace_in_value(src: str, key: str, fn: Callable[[str], str]) -> str:
    """Apply ``fn`` to each scalar of one key's value, replacing only what changed.

    Works on a scalar, a flow list, a block list or a block scalar (each of its
    lines). An item that ``fn`` changes is written in its own quote style:
    ``fn`` is applied to the item's source text when that reads back right (so
    escapes elsewhere in it are kept), else the new text is escaped for that
    style; a plain item that would now need quoting is single-quoted.
    Every other character of ``src`` is kept. A value that can't be edited in
    place that way (a nested mapping, a multi-line plain scalar that would
    need quoting...) is re-rendered whole, on the key's own lines only. An
    absent key, or no change, returns ``src`` itself. Raises `FrontmatterError`
    when ``src`` or the result is not valid YAML.
    """
    data = _load_rt(src)
    if data is None or key not in data:
        return src
    before = parse_fm(src)
    expected = _map_strings(before[key], fn)
    if expected == before[key]:
        return src

    def reads_back(out: str) -> bool:
        try:
            after = parse_fm(out)
        except FrontmatterError:
            return False
        return after.keys() == before.keys() and after[key] == expected

    if not data.fa.flow_style():
        out = _replace_in_place(src, data, key, fn)
        if out is not None and reads_back(out):
            return out
    # Re-render the whole value from the round-trip tree, each scalar in its own style.
    new_value = _map_rt(data[key], fn)
    if data.fa.flow_style():
        data[key] = new_value
        out = _dump(data)
    else:
        out = set_keys(src, {key: new_value})
    if not reads_back(out):
        raise FrontmatterError(f"Rewriting {key!r} broke its value")
    return out


def _map_strings(value: Any, fn: Callable[[str], str]) -> Any:
    """``value`` (plain) with ``fn`` applied to every string in it, keys aside."""
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, list):
        return [_map_strings(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: _map_strings(v, fn) for k, v in value.items()}
    return value


def _map_rt(value: Any, fn: Callable[[str], str]) -> Any:
    """A round-trip value with ``fn`` applied to every string scalar, keeping styles (in place)."""
    if isinstance(value, str):
        new = fn(str(value))
        return value if new == str(value) else _styled_like(value, new)
    if isinstance(value, list):
        for i, v in enumerate(value):
            value[i] = _map_rt(v, fn)
        return value
    if isinstance(value, dict):
        for k in list(value):
            value[k] = _map_rt(value[k], fn)
        return value
    return value


def _replace_in_place(
    src: str, data: CommentedMap, key: str, fn: Callable[[str], str]
) -> str | None:
    """`replace_in_value`'s byte-level edit of each changed scalar, or None when nothing changed.

    The caller checks that the result reads back as intended.
    """
    lines = _lines(src)
    start, end = _key_spans(data, lines)[key]
    row, col = data.lc.key(key)
    head = "".join(lines[:start])
    text = "".join(lines[start:end])
    tail = "".join(lines[end:])

    start_at = _value_start(lines, row, col)
    items = _scan_items(text, start_at)
    # A plain scalar running over several lines is edited line by line, each as it
    # stands (a continuation line may start with `[`, and quoting one line alone
    # would break the value).
    multiline_plain = False
    if isinstance(data[key], str) and not isinstance(data[key], ScalarString):
        nl = text.find("\n", start_at)
        if 0 <= nl < len(text.rstrip("\n")):
            multiline_plain = True
            s = start_at
            while s < nl and text[s] in " \t":
                s += 1
            e = nl
            while e > s and text[e - 1] in " \t\r":
                e -= 1
            items = ([(s, e, "plain")] if e > s else []) + _scan_block_scalar(text, start_at)
    changed = False
    for s, e, style in reversed(items):
        raw = text[s:e]
        old = _decode_item(raw, style)
        if old is None:
            continue
        new = fn(old)
        if new == old:
            continue
        line_start = text.rfind("\n", 0, s) + 1
        indent = re.match(r"[ \t]*", text[line_start:]).group(0)
        if multiline_plain:
            encoded = new
        elif style in ("'", '"') and _decode_item(raw[0] + fn(raw[1:-1]) + raw[-1], style) == new:
            encoded = raw[0] + fn(raw[1:-1]) + raw[-1]  # escapes elsewhere stay as written
        else:
            encoded = _encode_item(new, style, indent)
        text = text[:s] + encoded + text[e:]
        changed = True
    if not changed:
        return None
    return head + text + tail


def remove_items(src: str, key: str, drop: Callable[[str], bool]) -> str | None:
    """Remove the items of one key's list for which ``drop(item)`` is true, in place.

    Only the dropped items' bytes go: in a flow list the item and one adjacent
    comma, in a block list the item's line(s). Every other byte (quotes,
    comments, spacing) is kept. Returns ``src`` itself when nothing is dropped,
    and ``None`` when the edit can't be made in place: the value isn't a list
    of scalars, every item would go, the frontmatter is a flow mapping, or the
    result wouldn't read back as the kept items. Callers then fall back to
    `set_keys`.
    """
    data = _load_rt(src)
    if data is None or key not in data or data.fa.flow_style():
        return None
    value = data[key]
    if not isinstance(value, CommentedSeq):
        return None
    flow = bool(value.fa.flow_style())
    lines = _lines(src)
    start, end = _key_spans(data, lines)[key]
    row, col = data.lc.key(key)
    head = "".join(lines[:start])
    text = "".join(lines[start:end])
    tail = "".join(lines[end:])

    spans = _scan_items(text, _value_start(lines, row, col))
    if len(spans) != len(value):
        return None  # nested mappings, aliases…: not a plain list of scalars
    decoded = [_decode_item(text[s:e], style) for s, e, style in spans]
    if any(d is None for d in decoded):
        return None
    dropped = [i for i, d in enumerate(decoded) if drop(d)]
    if not dropped:
        return src
    if len(dropped) == len(spans):
        return None
    expected = [_plain(v) for i, v in enumerate(value) if i not in set(dropped)]

    for i in reversed(dropped):
        s, e, _style = spans[i]
        if flow:
            j = e
            while j < len(text) and text[j] in " \t\r\n":
                j += 1
            if j < len(text) and text[j] == ",":
                j += 1
                while j < len(text) and text[j] in " \t":
                    j += 1
                text = text[:s] + text[j:]
            else:
                k = s
                while k > 0 and text[k - 1] in " \t\r\n":
                    k -= 1
                if k > 0 and text[k - 1] == ",":
                    k -= 1
                text = text[:k] + text[e:]
        else:
            line_start = text.rfind("\n", 0, s) + 1
            if not re.fullmatch(r"[ \t]*-[ \t]+", text[line_start:s]):
                return None
            nl = text.find("\n", e)
            line_end = len(text) if nl < 0 else nl + 1
            text = text[:line_start] + text[line_end:]
    out = head + text + tail
    try:
        if parse_fm(out).get(key) != expected:
            return None
    except FrontmatterError:
        return None
    return out




# -- list membership edits ---------------------------------------------------------


def _crlf(src: str) -> bool:
    return "\r\n" in src and "\n" not in src.replace("\r\n", "")


def _empty_list_line(lines: list[str], row: int, col: int) -> str:
    """The key's own line rewritten as ``key: []``, keeping its indent and EOL."""
    line = lines[row]
    head = line[: _value_start(lines, row, col)]
    eol = "\n" if line.endswith("\n") else ""
    return f"{head} []{eol}"


def remove_from_list(
    src: str, key: str, pred: Callable[[str], bool]
) -> tuple[str, list[int]]:
    """Remove every scalar item of one key's list for which ``pred`` is true.

    Returns the new source and the removed indexes. Only the removed items' bytes
    go (in a flow list the item and one adjacent separator, in a block list the
    item's whole line); a list that becomes empty becomes ``key: []`` on the
    key's own line. A scalar value that ``pred`` accepts also becomes ``key: []``.
    An absent key or no match returns ``src`` unchanged.
    """
    if _crlf(src):
        out, idx = remove_from_list(src.replace("\r\n", "\n"), key, pred)
        return out.replace("\n", "\r\n"), idx
    data = _load_rt(src)
    if data is None or key not in data:
        return src, []
    value = data[key]
    if isinstance(value, str):
        if not pred(str(value)):
            return src, []
        return set_keys(src, {key: FlowList()}), [0]
    if not isinstance(value, CommentedSeq):
        return src, []
    plain = [_plain(v) for v in value]
    dropped = [i for i, v in enumerate(plain) if isinstance(v, str) and pred(v)]
    if not dropped:
        return src, []
    if len(dropped) == len(plain):
        if data.fa.flow_style():
            return set_keys(src, {key: FlowList()}), dropped
        lines = _lines(src)
        start, end = _key_spans(data, lines)[key]
        row, col = data.lc.key(key)
        out = "".join(lines[:start]) + _empty_list_line(lines, row, col) + "".join(lines[end:])
        return out, dropped
    gone = {plain[i] for i in dropped}
    done = remove_items(src, key, lambda item: item in gone)
    if done is None:
        kept = [v for i, v in enumerate(plain) if i not in set(dropped)]
        done = set_keys(src, {key: FlowList(kept)})
    return done, dropped


def insert_in_list(src: str, key: str, index: int, value: str) -> str:
    """Insert ``value`` at ``index`` (clamped) in one key's list, in the list's own style.

    ``key: []``, an absent key and a scalar value become a flow list holding the
    value (a scalar keeps its place relative to the new item).
    """
    if _crlf(src):
        return insert_in_list(src.replace("\r\n", "\n"), key, index, value).replace(
            "\n", "\r\n"
        )
    data = _load_rt(src)
    current = None if data is None or key not in data else data[key]
    if isinstance(current, str) or (isinstance(current, CommentedSeq) and len(current) == 0):
        items = [str(current)] if isinstance(current, str) else []
        items.insert(max(0, min(index, len(items))), value)
        if data.fa.flow_style():
            return set_keys(src, {key: FlowList(items)})
        lines = _lines(src)
        start, end = _key_spans(data, lines)[key]
        row, col = data.lc.key(key)
        head = lines[row][: _value_start(lines, row, col)]
        eol = "\n" if lines[row].endswith("\n") else ""
        body = ", ".join(_encode_item(v, "flow", "") for v in items)
        out = "".join(lines[:start]) + f"{head} [{body}]{eol}" + "".join(lines[end:])
        return out if parse_fm(out).get(key) == items else set_keys(src, {key: FlowList(items)})
    if not isinstance(current, CommentedSeq):
        return set_keys(src, {key: FlowList([value])})
    plain = [_plain(v) for v in current]
    index = max(0, min(index, len(plain)))
    expected = [*plain[:index], value, *plain[index:]]

    def fallback() -> str:
        return set_keys(src, {key: FlowList(expected)})

    if data.fa.flow_style():
        return fallback()
    flow = bool(current.fa.flow_style())
    lines = _lines(src)
    start, end = _key_spans(data, lines)[key]
    row, col = data.lc.key(key)
    head = "".join(lines[:start])
    text = "".join(lines[start:end])
    tail = "".join(lines[end:])
    spans = _scan_items(text, _value_start(lines, row, col))
    if len(spans) != len(plain):
        return fallback()
    if flow:
        enc = _encode_item(value, "flow", "")
        if index < len(spans):
            s = spans[index][0]
            text = text[:s] + enc + ", " + text[s:]
        else:
            e = spans[-1][1]
            text = text[:e] + ", " + enc + text[e:]
    else:
        first = spans[0][0]
        line_start = text.rfind("\n", 0, first) + 1
        prefix = text[line_start:first]
        if not re.fullmatch(r"[ \t]*-[ \t]+", prefix):
            return fallback()
        enc = _encode_item(value, "plain", "")
        new_line = prefix + enc + "\n"
        if index < len(spans):
            at = text.rfind("\n", 0, spans[index][0]) + 1
        else:
            nl = text.find("\n", spans[-1][1])
            at = len(text) if nl < 0 else nl + 1
        text = text[:at] + new_line + text[at:]
    out = head + text + tail
    try:
        if parse_fm(out).get(key) != expected:
            return fallback()
    except FrontmatterError:
        return fallback()
    return out
