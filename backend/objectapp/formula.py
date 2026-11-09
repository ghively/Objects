"""M12 formulas: a small expression language, parsed by hand and evaluated on the server.

The contract is ``docs/superpowers/plans/2026-11-05-m12-property-kinds.md`` ("Formula
language"). `parse` turns an expression into an AST of plain tuples (no ``eval``), `evaluate`
runs one against an `Env` (the object's property values and the app's clock), and
`to_computed` turns the result into the API's ``ComputedValue``. `references` lists the
property names an expression uses (cycle checks) and `rename_references` rewrites
``prop("Old")`` to ``prop("New")`` in the source text, leaving everything else as written.

Internal values: ``None`` (empty), ``str`` (text), ``int``/``float`` (number), ``bool``,
`FDate` (date), ``list`` (a list; its items are any of these but lists).

AST nodes::

    ("lit", value)                  a literal
    ("prop", name)                  prop("Name")
    ("call", name, [args])          a function call (method form included)
    ("neg", x) / ("not", x)         unary minus, logical not
    ("and", [xs]) / ("or", [xs])    short-circuit chains
    ("chain", first, [(op, x)...])  left-associative operators of one precedence level
"""

from __future__ import annotations

import calendar
import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, tzinfo
from functools import lru_cache
from typing import Any, Protocol

from .localtime import from_local, to_local

__all__ = [
    "MAX_DEPTH",
    "MAX_EXPRESSION",
    "MAX_LIST",
    "MAX_TEXT",
    "Env",
    "FDate",
    "FormulaError",
    "compute",
    "evaluate",
    "parse",
    "parse_cached",
    "references",
    "rename_references",
    "to_computed",
    "value_text",
]

MAX_EXPRESSION = 2000
MAX_DEPTH = 50
MAX_LIST = 1000
MAX_TEXT = 100_000
"""The longest text a formula may build (`replace`, ``+``, `concat`, `join`, `format`)."""
MAX_NUMBER_BITS = 1023
"""An integer of more bits is refused ("The number is too large."): it would not fit a float or JSON."""


class FormulaError(Exception):
    """A formula that doesn't parse or can't be evaluated (the message is shown on hover)."""


# -- dates ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class FDate:
    """A date value: a local day (`date`) or an instant (aware `datetime`), with an optional end."""

    start: date | datetime
    end: date | datetime | None = None

    @property
    def is_day(self) -> bool:
        return not isinstance(self.start, datetime)

    def instant(self, tz: tzinfo, which: str = "start") -> datetime:
        """The start (or end) as an aware UTC instant; a day is its local midnight."""
        v = self.start if which == "start" or self.end is None else self.end
        return _instant(v, tz)

    def iso(self) -> str:
        return _iso(self.start)


def _instant(v: date | datetime, tz: tzinfo) -> datetime:
    if isinstance(v, datetime):
        return v.astimezone(UTC)
    return from_local(datetime(v.year, v.month, v.day), tz)  # noqa: DTZ001 (a wall clock)


def _iso(v: date | datetime) -> str:
    if isinstance(v, datetime):
        dt = v.astimezone(UTC)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
    return v.isoformat()


def parse_date_text(text: str) -> FDate | None:
    """A day (``YYYY-MM-DD``) or an ISO instant (``Z`` or an offset; none means UTC) as `FDate`."""
    text = text.strip()
    if not text:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        try:
            return FDate(date.fromisoformat(text))
        except ValueError:
            return None
    try:
        dt = datetime.fromisoformat(text)  # Python 3.11+ reads a trailing "Z"
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return FDate(dt.astimezone(UTC))


# -- tokens ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Token:
    kind: str
    """``num``, ``str``, ``ident``, ``op`` or ``end``."""
    value: Any
    start: int
    end: int


_OPS = ("==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")", ",", ".")
_NUM_RE = re.compile(r"\d+(?:\.\d+)?")
_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_KEYWORDS = frozenset({"and", "or", "not", "true", "false"})


def tokenize(src: str) -> list[Token]:
    """The tokens of ``src`` (positions are character offsets). Raises `FormulaError`."""
    out: list[Token] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if c == '"':
            j = i + 1
            buf: list[str] = []
            while True:
                if j >= n:
                    raise FormulaError(f"Unterminated text starting at position {i + 1}.")
                ch = src[j]
                if ch == "\\" and j + 1 < n and src[j + 1] in '"\\':
                    buf.append(src[j + 1])
                    j += 2
                    continue
                if ch == '"':
                    break
                buf.append(ch)
                j += 1
            out.append(Token("str", "".join(buf), i, j + 1))
            i = j + 1
            continue
        m = _NUM_RE.match(src, i)
        if m:
            text = m.group(0)
            out.append(Token("num", float(text) if "." in text else int(text), i, m.end()))
            i = m.end()
            continue
        m = _IDENT_RE.match(src, i)
        if m:
            out.append(Token("ident", m.group(0), i, m.end()))
            i = m.end()
            continue
        for op in _OPS:
            if src.startswith(op, i):
                out.append(Token("op", op, i, i + len(op)))
                i += len(op)
                break
        else:
            raise FormulaError(f'Unexpected character "{c}" at position {i + 1}.')
    out.append(Token("end", None, n, n))
    return out


# -- functions: names and arities -------------------------------------------------------------

_MANY = 10_000
# name -> (min args, max args)
ARITY: dict[str, tuple[int, int]] = {
    "if": (3, 3),
    "ifs": (2, _MANY),
    "empty": (1, 1),
    "length": (1, 1),
    "contains": (2, 2),
    "concat": (1, _MANY),
    "join": (2, 2),
    "lower": (1, 1),
    "upper": (1, 1),
    "trim": (1, 1),
    "replace": (3, 3),
    "round": (1, 2),
    "floor": (1, 1),
    "ceil": (1, 1),
    "abs": (1, 1),
    "sqrt": (1, 1),
    "min": (1, _MANY),
    "max": (1, _MANY),
    "sum": (1, _MANY),
    "toNumber": (1, 1),
    "format": (1, 1),
    "now": (0, 0),
    "today": (0, 0),
    "dateAdd": (3, 3),
    "dateSubtract": (3, 3),
    "dateBetween": (3, 3),
    "formatDate": (2, 2),
    "year": (1, 1),
    "month": (1, 1),
    "day": (1, 1),
    "first": (1, 1),
    "last": (1, 1),
}
UNITS = ("years", "quarters", "months", "weeks", "days", "hours", "minutes")


# -- parser ------------------------------------------------------------------------------------


class _Parser:
    def __init__(self, src: str) -> None:
        self.src = src
        self.toks = tokenize(src)
        self.i = 0
        self.depth = 0

    # helpers
    def peek(self) -> Token:
        return self.toks[self.i]

    def next(self) -> Token:
        tok = self.toks[self.i]
        self.i += 1
        return tok

    def at_op(self, *ops: str) -> bool:
        tok = self.peek()
        return tok.kind == "op" and tok.value in ops

    def at_word(self, *words: str) -> bool:
        tok = self.peek()
        return tok.kind == "ident" and tok.value in words

    def expect_op(self, op: str) -> Token:
        tok = self.next()
        if tok.kind != "op" or tok.value != op:
            raise FormulaError(f'Expected "{op}" {self._where(tok)}.')
        return tok

    def _where(self, tok: Token) -> str:
        if tok.kind == "end":
            return "at the end of the formula"
        return f"at position {tok.start + 1}"

    def enter(self) -> None:
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise FormulaError(f"The formula is nested too deeply (at most {MAX_DEPTH} levels).")

    def leave(self) -> None:
        self.depth -= 1

    # grammar
    def parse(self) -> tuple:
        if self.peek().kind == "end":
            raise FormulaError("The formula is empty.")
        node = self.expr()
        tok = self.peek()
        if tok.kind != "end":
            raise FormulaError(f"Unexpected {self._show(tok)} {self._where(tok)}.")
        return node

    def _show(self, tok: Token) -> str:
        if tok.kind == "str":
            return "text"
        return repr(str(tok.value))

    def expr(self) -> tuple:
        return self.or_()

    def or_(self) -> tuple:
        items = [self.and_()]
        while self.at_op("||") or self.at_word("or"):
            self.next()
            items.append(self.and_())
        return items[0] if len(items) == 1 else ("or", items)

    def and_(self) -> tuple:
        items = [self.not_()]
        while self.at_op("&&") or self.at_word("and"):
            self.next()
            items.append(self.not_())
        return items[0] if len(items) == 1 else ("and", items)

    def not_(self) -> tuple:
        if self.at_op("!") or self.at_word("not"):
            self.next()
            self.enter()
            node = ("not", self.not_())
            self.leave()
            return node
        return self.comparison()

    def _chain(self, ops: tuple[str, ...], sub: Callable[[], tuple]) -> tuple:
        first = sub()
        rest: list[tuple[str, tuple]] = []
        while self.at_op(*ops):
            op = self.next().value
            rest.append((op, sub()))
        return first if not rest else ("chain", first, rest)

    def comparison(self) -> tuple:
        return self._chain(("==", "!=", "<", "<=", ">", ">="), self.additive)

    def additive(self) -> tuple:
        return self._chain(("+", "-"), self.multiplicative)

    def multiplicative(self) -> tuple:
        return self._chain(("*", "/", "%"), self.unary)

    def unary(self) -> tuple:
        if self.at_op("-"):
            self.next()
            self.enter()
            node = ("neg", self.unary())
            self.leave()
            return node
        return self.postfix()

    def postfix(self) -> tuple:
        node = self.primary()
        added = 0
        while self.at_op("."):
            self.next()
            tok = self.next()
            if tok.kind != "ident" or tok.value in _KEYWORDS:
                raise FormulaError(f'Expected a function name after "." {self._where(tok)}.')
            name = tok.value
            if name == "prop":
                raise FormulaError("The function prop can't be used in method form.")
            self.enter()
            added += 1
            args = self.args()
            node = self._call(name, [node, *args], tok)
        for _ in range(added):
            self.leave()
        return node

    def args(self) -> list[tuple]:
        self.expect_op("(")
        out: list[tuple] = []
        if self.at_op(")"):
            self.next()
            return out
        self.enter()
        while True:
            out.append(self.expr())
            if self.at_op(","):
                self.next()
                continue
            tok = self.next()
            if tok.kind == "op" and tok.value == ")":
                break
            raise FormulaError(f'Expected "," or ")" {self._where(tok)}.')
        self.leave()
        return out

    def _call(self, name: str, args: list[tuple], tok: Token) -> tuple:
        arity = ARITY.get(name)
        if arity is None:
            raise FormulaError(f'Unknown function "{name}".')
        lo, hi = arity
        if not lo <= len(args) <= hi:
            if lo == hi:
                want = f"{lo} argument{'s' if lo != 1 else ''}"
            elif hi == _MANY:
                want = f"at least {lo} argument{'s' if lo != 1 else ''}"
            else:
                want = f"{lo} to {hi} arguments"
            raise FormulaError(f"The function {name} takes {want}.")
        return ("call", name, args)

    def primary(self) -> tuple:
        tok = self.next()
        if tok.kind == "num":
            return ("lit", tok.value)
        if tok.kind == "str":
            return ("lit", tok.value)
        if tok.kind == "op" and tok.value == "(":
            self.enter()
            node = self.expr()
            self.expect_op(")")
            self.leave()
            return node
        if tok.kind == "ident":
            name = tok.value
            if name == "true":
                return ("lit", True)
            if name == "false":
                return ("lit", False)
            if name in _KEYWORDS:
                raise FormulaError(f'Unexpected "{name}" {self._where(tok)}.')
            if not self.at_op("("):
                raise FormulaError(f'Unknown name "{name}" (a property is written prop("{name}")).')
            if name == "prop":
                self.expect_op("(")
                arg = self.next()
                if arg.kind != "str":
                    raise FormulaError('The function prop takes a property name in quotes: prop("Name").')
                self.expect_op(")")
                return ("prop", arg.value)
            return self._call(name, self.args(), tok)
        if tok.kind == "end":
            raise FormulaError("A value is missing at the end of the formula.")
        raise FormulaError(f"Unexpected {self._show(tok)} {self._where(tok)}.")


def parse(src: str) -> tuple:
    """The AST of ``src``. Raises `FormulaError` (empty, too long, a syntax error, too deep)."""
    if not isinstance(src, str):
        raise FormulaError("The formula must be text.")
    if len(src) > MAX_EXPRESSION:
        raise FormulaError(f"The formula is longer than {MAX_EXPRESSION} characters.")
    return _Parser(src).parse()


@lru_cache(maxsize=2048)
def _parse_cached(src: str) -> tuple[tuple | None, str | None]:
    try:
        return parse(src), None
    except FormulaError as exc:
        return None, str(exc)
    except RecursionError:
        return None, "The formula is nested too deeply"


def parse_cached(src: str) -> tuple:
    """`parse`, remembered by expression text (the AST is immutable). Raises `FormulaError`."""
    node, error = _parse_cached(src)
    if error is not None:
        raise FormulaError(error)
    assert node is not None
    return node


def references(node: tuple) -> list[str]:
    """The property names ``node`` reads with ``prop("…")``, in order, without repeats."""
    out: list[str] = []

    def walk(n: tuple) -> None:
        tag = n[0]
        if tag == "prop":
            if n[1] not in out:
                out.append(n[1])
        elif tag == "call":
            for a in n[2]:
                walk(a)
        elif tag in ("neg", "not"):
            walk(n[1])
        elif tag in ("and", "or"):
            for x in n[1]:
                walk(x)
        elif tag == "chain":
            walk(n[1])
            for _op, x in n[2]:
                walk(x)

    walk(node)
    return out


def _quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def rename_references(src: str, rename: Callable[[str], str | None]) -> str:
    """``src`` with each ``prop("Name")`` whose ``rename(Name)`` is a new name rewritten.

    Everything else (spacing, other strings) stays as written. A formula that doesn't
    tokenize is returned as it is.
    """
    try:
        toks = tokenize(src)
    except FormulaError:
        return src
    out: list[str] = []
    pos = 0
    for k in range(len(toks) - 3):
        a, b, c, d = toks[k : k + 4]
        if (
            a.kind == "ident"
            and a.value == "prop"
            and b.kind == "op"
            and b.value == "("
            and c.kind == "str"
            and d.kind == "op"
            and d.value == ")"
            and not (k > 0 and toks[k - 1].kind == "op" and toks[k - 1].value == ".")
        ):
            new = rename(c.value)
            if new is not None and new != c.value:
                out.append(src[pos : c.start])
                out.append(_quote(new))
                pos = c.end
    out.append(src[pos:])
    return "".join(out)


# -- evaluation ---------------------------------------------------------------------------------


class Env(Protocol):
    now: datetime
    """The instant `now()` answers (aware)."""
    tz: tzinfo
    """The local zone of `today()` and the date parts."""

    def prop(self, name: str) -> Any:
        """The internal value of the object's property ``name``; raises `FormulaError`."""
        ...


_KIND_NAMES = {
    type(None): "empty",
    str: "text",
    bool: "true/false",
    int: "number",
    float: "number",
    FDate: "date",
    list: "list",
}


def _kind(v: Any) -> str:
    return _KIND_NAMES.get(type(v), "value")


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def num_text(n: float) -> str:
    if isinstance(n, float):
        if n.is_integer() and abs(n) < 1e21:
            return str(int(n))
        return repr(n)
    return str(n)


def value_text(v: Any) -> str:
    """A value as text (``format``, ``+`` with text, list items)."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if _is_num(v):
        return num_text(v)
    if isinstance(v, str):
        return v
    if isinstance(v, FDate):
        return v.iso()
    if isinstance(v, list):
        return ", ".join(t for t in (value_text(x) for x in v) if t)
    return str(v)


def _is_empty(v: Any) -> bool:
    return v is None or v == "" or (isinstance(v, list) and not v)


def _check_text(t: str) -> str:
    if len(t) > MAX_TEXT:
        raise FormulaError("The text is too long.")
    return t


def _check_list(items: list) -> list:
    if len(items) > MAX_LIST:
        raise FormulaError(f"A list holds at most {MAX_LIST} items.")
    return items


def _want(name: str, v: Any, *kinds: str) -> None:
    raise FormulaError(f"The function {name} takes {' or '.join(kinds)}, not {_kind(v)}.")


def _text_arg(name: str, v: Any) -> str | None:
    if v is None or isinstance(v, str):
        return v
    _want(name, v, "text")
    return None  # unreachable


def _num_arg(name: str, v: Any) -> int | float | None:
    if v is None or _is_num(v):
        return v
    _want(name, v, "a number")
    return None


def _date_arg(name: str, v: Any) -> FDate | None:
    if v is None or isinstance(v, FDate):
        return v
    _want(name, v, "a date")
    return None


def _bool_cond(name: str, v: Any) -> bool:
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    raise FormulaError(f"The function {name} needs a true/false condition, not {_kind(v)}.")


def _finite(n: float) -> int | float:
    if isinstance(n, float) and not math.isfinite(n):
        raise FormulaError("The result is not a finite number.")
    if isinstance(n, int) and n.bit_length() > MAX_NUMBER_BITS:
        raise FormulaError("The number is too large.")
    return n


def _sort_key(v: Any, tz: tzinfo) -> Any:
    if isinstance(v, FDate):
        return v.instant(tz)
    return v


def _compare(op: str, a: Any, b: Any, tz: tzinfo) -> Any:
    if op in ("==", "!="):
        if _is_empty(a) or _is_empty(b):
            same = _is_empty(a) and _is_empty(b)
        elif isinstance(a, list) or isinstance(b, list):
            if not (isinstance(a, list) and isinstance(b, list)):
                raise FormulaError(f"Can't compare {_kind(a)} and {_kind(b)}.")
            same = [value_text(x) for x in a] == [value_text(x) for x in b]
        else:
            ka, kb = _kind(a), _kind(b)
            if ka != kb:
                raise FormulaError(f"Can't compare {ka} and {kb}.")
            same = _sort_key(a, tz) == _sort_key(b, tz)
        return same if op == "==" else not same
    if a is None or b is None:
        return None
    ka, kb = _kind(a), _kind(b)
    if ka != kb or ka in ("list", "value"):
        raise FormulaError(f"Can't compare {ka} and {kb}.")
    x, y = _sort_key(a, tz), _sort_key(b, tz)
    if op == "<":
        return x < y
    if op == "<=":
        return x <= y
    if op == ">":
        return x > y
    return x >= y


def _arith(op: str, a: Any, b: Any) -> Any:
    if op == "+":
        if isinstance(a, str) or isinstance(b, str):
            ta, tb = value_text(a), value_text(b)
            if len(ta) + len(tb) > MAX_TEXT:
                raise FormulaError("The text is too long.")
            return ta + tb
        if a is None or b is None:
            if (a is None or _is_num(a)) and (b is None or _is_num(b)):
                return None
        elif _is_num(a) and _is_num(b):
            return _finite(a + b)
        if isinstance(a, FDate) or isinstance(b, FDate):
            raise FormulaError("Use dateAdd to add to a date.")
        raise FormulaError(f"Can't add {_kind(a)} and {_kind(b)}.")
    if (a is not None and not _is_num(a)) or (b is not None and not _is_num(b)):
        word = {"-": "subtract", "*": "multiply", "/": "divide", "%": "take the remainder of"}[op]
        raise FormulaError(f"Can't {word} {_kind(a)} and {_kind(b)}.")
    if a is None or b is None:
        return None
    if op == "-":
        return _finite(a - b)
    if op == "*":
        return _finite(a * b)
    if b == 0:
        raise FormulaError("Division by zero.")
    if op == "/":
        return _finite(a / b)
    r = math.fmod(a, b)
    return int(r) if isinstance(a, int) and isinstance(b, int) else r


def _local(d: FDate, tz: tzinfo) -> date | datetime:
    """The start as a local wall clock (a day stays a day)."""
    if d.is_day:
        return d.start
    return to_local(d.start, tz)  # type: ignore[arg-type]


def _add_months(v: date | datetime, months: int) -> date | datetime:
    total = v.year * 12 + (v.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    if not 1 <= year <= 9999:
        raise FormulaError("The date is out of range.")
    day = min(v.day, calendar.monthrange(year, month)[1])
    return v.replace(year=year, month=month, day=day)


def _date_add(d: FDate, n: float, unit: str, tz: tzinfo) -> FDate:
    if unit not in UNITS:
        raise FormulaError(f'Unknown unit "{unit}" (use {", ".join(UNITS)}).')
    try:
        if unit in ("years", "quarters", "months"):
            months = int(n) * {"years": 12, "quarters": 3, "months": 1}[unit]
            if d.is_day:
                return FDate(_add_months(d.start, months))
            local = to_local(d.start, tz)  # type: ignore[arg-type]
            moved = _add_months(local.replace(tzinfo=None), months)
            return FDate(from_local(moved, tz))  # type: ignore[arg-type]
        if unit in ("weeks", "days"):
            days = n * (7 if unit == "weeks" else 1)
            if d.is_day and float(days).is_integer():
                return FDate(d.start + timedelta(days=int(days)))
            if not d.is_day:
                # Calendar days on the local wall clock (a DST change keeps the time of day).
                local = to_local(d.start, tz).replace(tzinfo=None)  # type: ignore[arg-type]
                return FDate(from_local(local + timedelta(days=days), tz))
            return FDate(d.instant(tz) + timedelta(days=days))
        delta = timedelta(hours=n) if unit == "hours" else timedelta(minutes=n)
        return FDate(d.instant(tz) + delta)
    except (OverflowError, ValueError) as exc:
        raise FormulaError("The date is out of range.") from exc


def _trunc(x: float) -> int:
    return math.trunc(x)


def _date_between(a: FDate, b: FDate, unit: str, tz: tzinfo) -> int:
    if unit not in UNITS:
        raise FormulaError(f'Unknown unit "{unit}" (use {", ".join(UNITS)}).')
    if unit in ("years", "quarters", "months"):
        la, lb = _local(a, tz), _local(b, tz)
        if isinstance(la, datetime) != isinstance(lb, datetime):
            la = la if isinstance(la, datetime) else datetime(la.year, la.month, la.day)  # noqa: DTZ001
            lb = lb if isinstance(lb, datetime) else datetime(lb.year, lb.month, lb.day)  # noqa: DTZ001
            la, lb = la.replace(tzinfo=None), lb.replace(tzinfo=None)
        months = (la.year - lb.year) * 12 + (la.month - lb.month)

        def rest(v: date | datetime) -> tuple:
            if isinstance(v, datetime):
                return (v.day, v.hour, v.minute, v.second, v.microsecond)
            return (v.day,)

        if months > 0 and rest(la) < rest(lb):
            months -= 1
        elif months < 0 and rest(la) > rest(lb):
            months += 1
        per = {"years": 12, "quarters": 3, "months": 1}[unit]
        return _trunc(months / per)
    if unit in ("weeks", "days") and a.is_day and b.is_day:
        days = (a.start - b.start).days  # type: ignore[operator]
        return _trunc(days / 7) if unit == "weeks" else days
    seconds = (a.instant(tz) - b.instant(tz)).total_seconds()
    per_s = {"weeks": 7 * 86400, "days": 86400, "hours": 3600, "minutes": 60}[unit]
    return _trunc(seconds / per_s)


_DATE_TOKEN_RE = re.compile(r"YYYY|MM|DD|HH|mm")


def _format_date(d: FDate, pattern: str, tz: tzinfo) -> str:
    v = _local(d, tz)
    parts = {
        "YYYY": f"{v.year:04d}",
        "MM": f"{v.month:02d}",
        "DD": f"{v.day:02d}",
        "HH": f"{v.hour:02d}" if isinstance(v, datetime) else "00",
        "mm": f"{v.minute:02d}" if isinstance(v, datetime) else "00",
    }
    return _DATE_TOKEN_RE.sub(lambda m: parts[m.group(0)], pattern)


def _round(n: float, digits: int) -> int | float:
    f = 10.0**digits
    sign = -1 if n < 0 else 1
    r = sign * math.floor(abs(n) * f + 0.5) / f
    return int(r) if digits <= 0 else _finite(r)


def _numbers(name: str, args: list[Any]) -> list[Any]:
    out: list[Any] = []
    for a in args:
        for v in a if isinstance(a, list) else [a]:
            if v is None or v == "":
                continue
            if _is_num(v) or isinstance(v, FDate):
                out.append(v)
            else:
                _want(name, v, "numbers")
    return out


def _to_number(v: Any) -> Any:
    if v is None or _is_num(v):
        return v
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, str):
        text = v.strip()
        if not text:
            return None
        try:
            n = int(text)
        except ValueError:
            try:
                n = float(text)
            except ValueError:
                return None
        return n if not isinstance(n, float) or math.isfinite(n) else None
    if isinstance(v, FDate):
        # Milliseconds since 1970 (as JavaScript dates count).
        return int(v.instant(UTC).timestamp() * 1000)
    raise FormulaError(f"The function toNumber takes text, a number, a date or true/false, not {_kind(v)}.")


class _Evaluator:
    def __init__(self, env: Env) -> None:
        self.env = env
        self.tz = env.tz

    def ev(self, n: tuple) -> Any:
        tag = n[0]
        if tag == "lit":
            return n[1]
        if tag == "prop":
            return self.env.prop(n[1])
        if tag == "call":
            return self.call(n[1], n[2])
        if tag == "neg":
            v = self.ev(n[1])
            if v is None:
                return None
            if not _is_num(v):
                raise FormulaError(f"Can't negate {_kind(v)}.")
            return -v
        if tag == "not":
            return not _bool_cond("not", self.ev(n[1]))
        if tag == "and":
            for x in n[1]:
                if not _bool_cond("and", self.ev(x)):
                    return False
            return True
        if tag == "or":
            for x in n[1]:
                if _bool_cond("or", self.ev(x)):
                    return True
            return False
        if tag == "chain":
            acc = self.ev(n[1])
            for op, x in n[2]:
                rhs = self.ev(x)
                if op in ("==", "!=", "<", "<=", ">", ">="):
                    acc = _compare(op, acc, rhs, self.tz)
                else:
                    acc = _arith(op, acc, rhs)
            return acc
        raise FormulaError(f'Unknown node "{tag}".')  # pragma: no cover

    def call(self, name: str, args: list[tuple]) -> Any:
        # The lazy ones first: only the branch taken is evaluated.
        if name == "if":
            cond = _bool_cond("if", self.ev(args[0]))
            return self.ev(args[1] if cond else args[2])
        if name == "ifs":
            k = 0
            while k + 1 < len(args):
                if _bool_cond("ifs", self.ev(args[k])):
                    return self.ev(args[k + 1])
                k += 2
            return self.ev(args[k]) if k < len(args) else None
        vals = [self.ev(a) for a in args]
        fn = getattr(self, "f_" + name)
        return fn(*vals)

    # -- logic and text -------------------------------------------------------------
    def f_empty(self, x: Any) -> bool:
        return _is_empty(x)

    def f_length(self, x: Any) -> int:
        if x is None:
            return 0
        if isinstance(x, (str, list)):
            return len(x)
        _want("length", x, "text", "a list")
        return 0

    def f_contains(self, x: Any, y: Any) -> bool:
        if x is None:
            return False
        if isinstance(x, list):
            wanted = value_text(y)
            return any(value_text(i) == wanted for i in x)
        if isinstance(x, str):
            return value_text(y) in x
        _want("contains", x, "text", "a list")
        return False

    def f_concat(self, *xs: Any) -> Any:
        present = [x for x in xs if x is not None]
        if any(isinstance(x, list) for x in present):
            out: list[Any] = []
            for x in present:
                if not isinstance(x, list):
                    _want("concat", x, "lists")
                out.extend(x)
            return _check_list(out)
        for x in present:
            if not isinstance(x, str):
                _want("concat", x, "text", "lists")
        if sum(len(x) for x in present) > MAX_TEXT:
            raise FormulaError("The text is too long.")
        return "".join(present) if present else None

    def f_join(self, xs: Any, sep: Any) -> Any:
        sep = _text_arg("join", sep) or ""
        if xs is None:
            return None
        if not isinstance(xs, list):
            _want("join", xs, "a list")
        parts = [t for t in (value_text(x) for x in xs) if t]
        if sum(len(t) for t in parts) + len(sep) * max(len(parts) - 1, 0) > MAX_TEXT:
            raise FormulaError("The text is too long.")
        return sep.join(parts)

    def f_lower(self, x: Any) -> Any:
        t = _text_arg("lower", x)
        return t.lower() if t is not None else None

    def f_upper(self, x: Any) -> Any:
        t = _text_arg("upper", x)
        return t.upper() if t is not None else None

    def f_trim(self, x: Any) -> Any:
        t = _text_arg("trim", x)
        return t.strip() if t is not None else None

    def f_replace(self, x: Any, find: Any, repl: Any) -> Any:
        t = _text_arg("replace", x)
        f = _text_arg("replace", find) or ""
        r = _text_arg("replace", repl) or ""
        if t is None:
            return None
        if not f:
            return t
        # Predict the size before building: nested replaces would otherwise grow without bound.
        if len(t) + t.count(f) * (len(r) - len(f)) > MAX_TEXT:
            raise FormulaError("The text is too long.")
        return t.replace(f, r)

    # -- numbers ----------------------------------------------------------------------
    def f_round(self, x: Any, digits: Any = 0) -> Any:
        n = _num_arg("round", x)
        d = _num_arg("round", digits)
        if n is None:
            return None
        d = int(d or 0)
        if not -15 <= d <= 15:
            raise FormulaError("The function round takes 0 to 15 digits.")
        return _round(n, d)

    def f_floor(self, x: Any) -> Any:
        n = _num_arg("floor", x)
        return None if n is None else math.floor(n)

    def f_ceil(self, x: Any) -> Any:
        n = _num_arg("ceil", x)
        return None if n is None else math.ceil(n)

    def f_abs(self, x: Any) -> Any:
        n = _num_arg("abs", x)
        return None if n is None else abs(n)

    def f_sqrt(self, x: Any) -> Any:
        n = _num_arg("sqrt", x)
        if n is None:
            return None
        if n < 0:
            raise FormulaError("The function sqrt can't take a negative number.")
        r = math.sqrt(n)
        return int(r) if r.is_integer() else r

    def _extreme(self, name: str, xs: tuple, pick: Callable) -> Any:
        items = _numbers(name, list(xs))
        if not items:
            return None
        kinds = {_kind(i) for i in items}
        if len(kinds) > 1:
            raise FormulaError(f"The function {name} can't mix numbers and dates.")
        return pick(items, key=lambda v: _sort_key(v, self.tz))

    def f_min(self, *xs: Any) -> Any:
        return self._extreme("min", xs, min)

    def f_max(self, *xs: Any) -> Any:
        return self._extreme("max", xs, max)

    def f_sum(self, *xs: Any) -> Any:
        items = _numbers("sum", list(xs))
        if any(isinstance(i, FDate) for i in items):
            raise FormulaError("The function sum takes numbers, not dates.")
        if not items:
            return None
        return _finite(math.fsum(items) if any(isinstance(i, float) for i in items) else sum(items))

    def f_toNumber(self, x: Any) -> Any:
        return _to_number(x)

    def f_format(self, x: Any) -> str:
        return _check_text(value_text(x))

    # -- dates ------------------------------------------------------------------------
    def f_now(self) -> FDate:
        return FDate(self.env.now.astimezone(UTC))

    def f_today(self) -> FDate:
        return FDate(to_local(self.env.now, self.tz).date())

    def _unit(self, name: str, u: Any) -> str:
        if not isinstance(u, str):
            raise FormulaError(f"The function {name} takes a unit in quotes ({', '.join(UNITS)}).")
        return u

    def f_dateAdd(self, d: Any, n: Any, unit: Any) -> Any:
        dv, nv, u = _date_arg("dateAdd", d), _num_arg("dateAdd", n), self._unit("dateAdd", unit)
        if dv is None or nv is None:
            return None
        return _date_add(dv, nv, u, self.tz)

    def f_dateSubtract(self, d: Any, n: Any, unit: Any) -> Any:
        dv, nv = _date_arg("dateSubtract", d), _num_arg("dateSubtract", n)
        u = self._unit("dateSubtract", unit)
        if dv is None or nv is None:
            return None
        return _date_add(dv, -nv, u, self.tz)

    def f_dateBetween(self, a: Any, b: Any, unit: Any) -> Any:
        av, bv = _date_arg("dateBetween", a), _date_arg("dateBetween", b)
        u = self._unit("dateBetween", unit)
        if av is None or bv is None:
            return None
        return _date_between(av, bv, u, self.tz)

    def f_formatDate(self, d: Any, pattern: Any) -> Any:
        dv = _date_arg("formatDate", d)
        p = _text_arg("formatDate", pattern) or ""
        return None if dv is None else _check_text(_format_date(dv, p, self.tz))

    def f_year(self, d: Any) -> Any:
        dv = _date_arg("year", d)
        return None if dv is None else _local(dv, self.tz).year

    def f_month(self, d: Any) -> Any:
        dv = _date_arg("month", d)
        return None if dv is None else _local(dv, self.tz).month

    def f_day(self, d: Any) -> Any:
        dv = _date_arg("day", d)
        return None if dv is None else _local(dv, self.tz).day

    # -- lists ------------------------------------------------------------------------
    def f_first(self, xs: Any) -> Any:
        if xs is None:
            return None
        if not isinstance(xs, list):
            _want("first", xs, "a list")
        return xs[0] if xs else None

    def f_last(self, xs: Any) -> Any:
        if xs is None:
            return None
        if not isinstance(xs, list):
            _want("last", xs, "a list")
        return xs[-1] if xs else None


def evaluate(node: tuple, env: Env) -> Any:
    """The internal value of ``node`` in ``env``. Raises `FormulaError`."""
    try:
        return _Evaluator(env).ev(node)
    except RecursionError as exc:
        raise FormulaError("The formula is nested too deeply.") from exc
    except (OverflowError, ArithmeticError, ValueError) as exc:
        # ValueError: `floor(NaN)`, or an integer over Python's 4,300-digit text limit.
        raise FormulaError("The result is out of range.") from exc


def error_value(message: str) -> dict[str, Any]:
    return {"type": "error", "value": None, "error": message}


def to_computed(v: Any) -> dict[str, Any]:
    """The API ``ComputedValue`` of an internal value."""
    try:
        return _to_computed(v)
    except (OverflowError, ValueError, ArithmeticError):
        # An integer too long to write as text (Python refuses over 4,300 digits).
        return error_value("The number is too large.")


def _to_computed(v: Any) -> dict[str, Any]:
    if v is None or v == "":
        return {"type": "empty", "value": None}
    if isinstance(v, bool):
        return {"type": "boolean", "value": v}
    if _is_num(v):
        if isinstance(v, float) and not math.isfinite(v):
            return error_value("The result is not a finite number")
        if isinstance(v, int) and v.bit_length() > MAX_NUMBER_BITS:
            return error_value("The number is too large.")
        return {"type": "number", "value": v}
    if isinstance(v, str):
        return {"type": "text", "value": v}
    if isinstance(v, FDate):
        return {"type": "date", "value": v.iso()}
    if isinstance(v, list):
        if len(v) > MAX_LIST:
            return error_value(f"A list holds at most {MAX_LIST} items.")
        return {"type": "list", "value": [t for t in (value_text(x) for x in v) if t]}
    return error_value(f"Unsupported value {type(v).__name__}")


def compute(expression: str, env: Env) -> dict[str, Any]:
    """The ``ComputedValue`` of ``expression`` (an empty expression is empty, errors are values)."""
    if not isinstance(expression, str) or not expression.strip():
        return {"type": "empty", "value": None}
    try:
        return to_computed(evaluate(parse_cached(expression), env))
    except FormulaError as exc:
        return error_value(str(exc))
