"""M12 rollups: a calculation over a property of the objects a relation links to.

`rollup_value` gathers the values and `calculate` runs the calculation; the names and the
count/percent/median semantics mirror the table footer's ``frontend/src/views/calc.ts``,
except that the percentages are fractions (0–1, as the contract has them).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .formula import MAX_LIST, FDate, FormulaError, num_text, value_text

if TYPE_CHECKING:
    from datetime import tzinfo

    from .computed import Computer, Obj
    from .typemodel import PropertyDefinition

__all__ = ["ROLLUP_CALCS", "calculate", "rollup_value"]

ROLLUP_CALCS = (
    "showOriginal",
    "showUnique",
    "countAll",
    "countValues",
    "countUnique",
    "countEmpty",
    "countNotEmpty",
    "percentEmpty",
    "percentNotEmpty",
    "sum",
    "average",
    "median",
    "min",
    "max",
    "range",
    "earliestDate",
    "latestDate",
    "dateRange",
)


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _keys(v: Any) -> list[str]:
    """The distinct-able items of one related object's value (calc.ts ``Cell.keys``)."""
    if v is None:
        return []
    if isinstance(v, bool):
        return ["true"] if v else []
    if isinstance(v, list):
        return [t for t in (value_text(x) for x in v) if t.strip()]
    if isinstance(v, str):
        return [v] if v.strip() else []
    if _is_num(v):
        return [num_text(v)]
    if isinstance(v, FDate):
        return [v.iso()]
    return []


def _r10(x: float) -> int | float:
    r = round(x, 10)
    return int(r) if float(r).is_integer() and abs(r) < 2**53 else r


def _count(calc: str, cells: list[list[str]], total: int) -> int | float:
    filled = sum(1 for c in cells if c)
    if calc == "countValues":
        return sum(len(c) for c in cells)
    if calc == "countUnique":
        return len({k for c in cells for k in c})
    if calc == "countEmpty":
        return total - filled
    if calc == "countNotEmpty":
        return filled
    if calc == "percentEmpty":
        return _r10((total - filled) / total) if total else 0
    return _r10(filled / total) if total else 0


def calculate(calc: str, values: list[Any], tz: tzinfo) -> Any:
    """The internal value of ``calc`` over the related objects' ``values`` (one per object)."""
    total = len(values)
    if calc == "countAll":
        return total
    if calc in ("showOriginal", "showUnique"):
        items = [k for v in values for k in _keys(v)]
        if calc == "showUnique":
            items = list(dict.fromkeys(items))
        return items[:MAX_LIST]
    if calc in ("countValues", "countUnique", "countEmpty", "countNotEmpty",
                "percentEmpty", "percentNotEmpty"):
        return _count(calc, [_keys(v) for v in values], total)
    if calc in ("sum", "average", "median", "min", "max", "range"):
        nums = sorted(v for v in values if _is_num(v))
        if not nums:
            return None
        if calc == "sum":
            return _r10(sum(nums))
        if calc == "average":
            return _r10(sum(nums) / len(nums))
        if calc == "median":
            mid = len(nums) // 2
            return _r10(nums[mid] if len(nums) % 2 else (nums[mid - 1] + nums[mid]) / 2)
        if calc == "min":
            return nums[0]
        if calc == "max":
            return nums[-1]
        return _r10(nums[-1] - nums[0])
    if calc in ("earliestDate", "latestDate", "dateRange"):
        dates = [v for v in values if isinstance(v, FDate)]
        if not dates:
            return None
        earliest = min(dates, key=lambda d: d.instant(tz))
        # The latest is the latest end (or start), as the footer has it.
        latest = max(dates, key=lambda d: d.instant(tz, "end"))
        latest_v = latest.end if latest.end is not None else latest.start
        if calc == "earliestDate":
            return FDate(earliest.start)
        if calc == "latestDate":
            return FDate(latest_v)
        a, b = FDate(earliest.start), FDate(latest_v)
        if a.is_day and b.is_day:
            return (b.start - a.start).days  # type: ignore[operator]
        return _r10((b.instant(tz) - a.instant(tz)).total_seconds() / 86400)
    raise FormulaError(f"Unknown calculation {calc!r}")


def rollup_value(c: Computer, obj: Obj, p: PropertyDefinition) -> Any:
    """The internal value of rollup ``p`` on ``obj``. Raises `FormulaError`."""
    opts = p.options
    rel_id = opts.get("relationId")
    target_id = opts.get("targetId")
    calc = opts.get("calc") or "showOriginal"
    if not isinstance(rel_id, str) or not rel_id or not isinstance(target_id, str) or not target_id:
        return None
    if calc not in ROLLUP_CALCS:
        raise FormulaError(f"Unknown calculation {calc!r}")
    rel = c.prop_by_id(obj.t, rel_id)
    if rel is None or rel.type != "entity":
        # Only a type file stored that way gets here (saving refuses it): empty, like no relation.
        return None
    related = c.related(obj, rel)
    if calc == "countAll":
        return len(related)
    return calculate(calc, [c.target_value(r, target_id) for r in related], c.tz)
