"""M12 formula language: tokenizer, parser, evaluator, references and renames (unit tests)."""

from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from objectapp.formula import (
    MAX_DEPTH,
    FDate,
    FormulaError,
    compute,
    parse,
    references,
    rename_references,
    tokenize,
)

NOW = datetime(2026, 11, 5, 22, 30, tzinfo=UTC)
# UTC-5: at NOW it is still the 5th, 17:30 locally.
EST = timezone(timedelta(hours=-5))


class Env:
    def __init__(self, props=None, now=NOW, tz=UTC):
        self.props = props or {}
        self.now = now
        self.tz = tz

    def prop(self, name):
        if name in self.props:
            return self.props[name]
        raise FormulaError(f'Unknown property "{name}"')


def ev(expr, tz=UTC, **props):
    return compute(expr, Env({k.replace("_", " "): v for k, v in props.items()}, tz=tz))


def val(expr, **props):
    out = ev(expr, **props)
    assert out["type"] != "error", out
    return out["value"]


def err(expr, **props):
    out = ev(expr, **props)
    assert out["type"] == "error", out
    assert out["value"] is None
    return out["error"]


# -- literals, tokens, parse errors ---------------------------------------------------------


def test_literals():
    assert ev("12") == {"type": "number", "value": 12}
    assert ev("1.5") == {"type": "number", "value": 1.5}
    assert ev('"hi"') == {"type": "text", "value": "hi"}
    assert ev('"a \\"q\\" \\\\ b"') == {"type": "text", "value": 'a "q" \\ b'}
    assert ev("true") == {"type": "boolean", "value": True}
    assert ev("false") == {"type": "boolean", "value": False}
    assert ev('""') == {"type": "empty", "value": None}
    assert ev("") == {"type": "empty", "value": None}
    assert ev("   ") == {"type": "empty", "value": None}


def test_tokenize_positions():
    toks = tokenize('prop("A") + 1')
    assert [t.kind for t in toks] == ["ident", "op", "str", "op", "op", "num", "end"]
    assert toks[2].start == 5 and toks[2].end == 8


@pytest.mark.parametrize(
    "expr, message",
    [
        ("1 +", "end of the formula"),
        ("(1", "Expected ')'"),
        ('"open', "Unterminated text"),
        ("1 $ 2", "Unexpected character"),
        ("foo(1)", "Unknown function 'foo'"),
        ("Budget", "prop(\"Budget\")"),
        ("prop(Budget)", "prop takes a property name in quotes"),
        ("if(true, 1)", "if takes 3 arguments"),
        ("now(1)", "now takes 0 arguments"),
        ("round(1, 2, 3)", "round takes 1 to 2 arguments"),
        ("1 2", "Unexpected"),
        ("x.prop()", "Unknown name"),
        ("1.prop()", "prop can't be used in method form"),
        ("(1).foo()", "Unknown function 'foo'"),
    ],
)
def test_parse_errors(expr, message):
    with pytest.raises(FormulaError) as exc:
        parse(expr)
    assert message in str(exc.value)
    # At evaluation time a parse error is an error value, never an exception.
    assert ev(expr)["type"] == "error"


def test_length_limit():
    with pytest.raises(FormulaError, match="longer than 2000"):
        parse("1+" * 1000 + "1")
    assert len("1+" * 999 + "1") <= 2000
    assert val("1+" * 999 + "1") == 1000  # a long flat chain is not deep


def test_depth_limit():
    ok = "(" * MAX_DEPTH + "1" + ")" * MAX_DEPTH
    assert val(ok) == 1
    deep = "(" * (MAX_DEPTH + 1) + "1" + ")" * (MAX_DEPTH + 1)
    with pytest.raises(FormulaError, match="nested too deeply"):
        parse(deep)
    assert "nested too deeply" in err(deep)
    with pytest.raises(FormulaError, match="nested too deeply"):
        parse("-" * 60 + "1")
    with pytest.raises(FormulaError, match="nested too deeply"):
        parse("abs(" * 60 + "1" + ")" * 60)
    # 1000 nested parentheses fit in 2000 characters: refused, not a RecursionError.
    with pytest.raises(FormulaError):
        parse("(" * 999 + ")" * 999)


# -- operators and precedence ------------------------------------------------------------------


@pytest.mark.parametrize(
    "expr, expected",
    [
        ("1 + 2 * 3", 7),
        ("(1 + 2) * 3", 9),
        ("10 - 4 - 3", 3),
        ("2 * 3 % 4", 2),
        ("7 % 3", 1),
        ("-7 % 3", -1),
        ("10 / 4", 2.5),
        ("-2 * 3", -6),
        ("- -2", 2),
        ("1 + 2 == 3", True),
        ("1 < 2 == true", True),
        ("not 1 == 2", True),
        ("!false and true", True),
        ("true or false and false", True),
        ("(true or false) and false", False),
        ("true || false && false", True),
        ("1 >= 1 and 2 > 1 and 1 <= 2 and 1 != 2", True),
        ('"b" > "a"', True),
        ('"a" + 1', "a1"),
        ('1 + "a"', "1a"),
        ('"x" + true', "xtrue"),
        ('"n=" + 1.5', "n=1.5"),
        ("2.5 + 2.5", 5.0),
    ],
)
def test_operators(expr, expected):
    assert val(expr) == expected


def test_comparisons_need_the_same_kind():
    assert "Can't compare" in err('1 < "a"')
    assert "Can't compare" in err('1 == "1"')
    assert "Can't compare" in err("true < 1")
    assert val("true == true") is True


def test_operator_type_errors():
    assert "Can't multiply" in err('"a" * 2')
    assert "Can't negate" in err('-"a"')
    assert "true/false" in err("1 and true")
    assert "true/false" in err("not 1")
    assert "Division by zero" in err("1 / 0")
    assert "Division by zero" in err("1 % 0")


def test_short_circuit():
    # The right side would be an error; it is never evaluated.
    assert val("false and 1 / 0 == 1") is False
    assert val("true or 1 / 0 == 1") is True
    assert val('if(true, 1, prop("Missing"))') == 1


# -- empty propagation ----------------------------------------------------------------------


def test_empty_propagates_quietly():
    assert ev('prop("N") + 1', N=None) == {"type": "empty", "value": None}
    assert ev('prop("N") * 2', N=None)["type"] == "empty"
    assert ev('-prop("N")', N=None)["type"] == "empty"
    assert val('"a" + prop("N")', N=None) == "a"
    assert val('prop("N") + "a"', N=None) == "a"
    assert ev('prop("N") < 1', N=None)["type"] == "empty"
    assert val('prop("N") == ""', N=None) is True
    assert val('prop("N") != 1', N=None) is True
    assert val('if(prop("N"), 1, 2)', N=None) == 2
    assert val('not prop("N")', N=None) is True
    assert ev('round(prop("N"))', N=None)["type"] == "empty"
    assert ev('upper(prop("N"))', N=None)["type"] == "empty"


# -- properties and method form ---------------------------------------------------------------


def test_prop_and_unknown_prop():
    assert val('prop("Budget") * 2', Budget=21) == 42
    assert err('prop("Nope")') == 'Unknown property "Nope"'


def test_method_form():
    assert val('"  Hi ".trim().lower()') == "hi"
    assert val('prop("Name").upper()', Name="ada") == "ADA"
    assert val('prop("L").join(", ")', L=["a", "b"]) == "a, b"
    assert val("(2.567).round(2)") == 2.57
    assert val('"abc".contains("b")') is True


# -- functions ------------------------------------------------------------------------------


def test_if_and_ifs():
    assert val('if(1 > 2, "a", "b")') == "b"
    assert "true/false condition" in err('if(1, "a", "b")')
    assert val('ifs(false, 1, true, 2, 3)') == 2
    assert val('ifs(false, 1, false, 2, 3)') == 3
    assert ev("ifs(false, 1)")["type"] == "empty"


def test_empty_length_contains():
    assert val('empty("")') is True
    assert val('empty(prop("L"))', L=[]) is True
    assert val("empty(0)") is False
    assert val('length("hello")') == 5
    assert val('length(prop("L"))', L=["a", "b", "c"]) == 3
    assert val('length(prop("N"))', N=None) == 0
    assert "length takes text or a list" in err("length(5)")
    assert val('contains("Hello", "ell")') is True
    assert val('contains(prop("L"), "b")', L=["a", "b"]) is True
    assert val('contains(prop("L"), "z")', L=["a", "b"]) is False
    assert val('contains(prop("N"), "z")', N=None) is False


def test_text_functions():
    assert val('concat("a", "b", "c")') == "abc"
    assert ev('concat(prop("A"), prop("B"))', A=["x"], B=["y", "z"]) == {
        "type": "list",
        "value": ["x", "y", "z"],
    }
    assert "concat takes lists" in err('concat(prop("A"), "b")', A=["x"])
    assert val('join(prop("L"), " / ")', L=["a", "b"]) == "a / b"
    assert val('lower("AbC")') == "abc"
    assert val('upper("AbC")') == "ABC"
    assert val('trim("  a b  ")') == "a b"
    assert val('replace("a.b.c", ".", "-")') == "a-b-c"
    assert val('replace("a*b", "*", "+")') == "a+b"  # plain text, no regex
    assert "lower takes text" in err("lower(1)")


def test_number_functions():
    assert val("round(2.5)") == 3
    assert val("round(-2.5)") == -3
    assert val("round(1.2345, 2)") == 1.23
    assert val("floor(2.7)") == 2
    assert val("ceil(2.1)") == 3
    assert val("abs(-3)") == 3
    assert val("sqrt(16)") == 4
    assert "negative" in err("sqrt(-1)")
    assert val("min(3, 1, 2)") == 1
    assert val("max(3, 1, 2)") == 3
    assert val("sum(1, 2, 3.5)") == 6.5
    assert val('sum(prop("N"), 2)', N=None) == 2
    assert val('max(prop("L"))', L=[4, 9]) == 9
    assert "sum takes numbers" in err('sum(1, "a")')
    assert ev("min(prop(\"N\"))", N=None)["type"] == "empty"


def test_to_number_and_format():
    assert val('toNumber("42")') == 42
    assert val('toNumber(" 1.5 ")') == 1.5
    assert ev('toNumber("abc")')["type"] == "empty"
    assert val("toNumber(true)") == 1
    assert val('toNumber(prop("D"))', D=FDate(date(1970, 1, 2))) == 86_400_000
    assert val("format(12)") == "12"
    assert val("format(1.5)") == "1.5"
    assert val("format(true)") == "true"
    assert val('format(prop("D"))', D=FDate(date(2026, 1, 2))) == "2026-01-02"
    assert val('format(prop("L"))', L=["a", "b"]) == "a, b"
    assert ev('format(prop("N"))', N=None)["type"] == "empty"


def test_first_last():
    assert val('first(prop("L"))', L=["a", "b"]) == "a"
    assert val('last(prop("L"))', L=["a", "b"]) == "b"
    assert ev('first(prop("L"))', L=[])["type"] == "empty"
    assert "first takes a list" in err('first("a")')


def test_list_limit():
    big = [str(i) for i in range(600)]
    assert "at most 1000 items" in err('concat(prop("A"), prop("B"))', A=big, B=big)
    assert ev('prop("L")', L=big)["type"] == "list"


# -- dates (fixed clock) -------------------------------------------------------------------------


def test_now_and_today():
    assert ev("now()") == {"type": "date", "value": "2026-11-05T22:30:00.000Z"}
    assert ev("today()") == {"type": "date", "value": "2026-11-05"}
    # The local day decides today(): at 22:30 UTC it is already the 6th at UTC+3.
    assert ev("today()", tz=timezone(timedelta(hours=3)))["value"] == "2026-11-06"
    assert ev("today()", tz=EST)["value"] == "2026-11-05"


def test_date_add_subtract():
    d = FDate(date(2026, 1, 31))
    assert val('dateAdd(prop("D"), 1, "months")', D=d) == "2026-02-28"
    assert val('dateAdd(prop("D"), 1, "years")', D=d) == "2027-01-31"
    assert val('dateAdd(prop("D"), 1, "quarters")', D=d) == "2026-04-30"
    assert val('dateAdd(prop("D"), 2, "weeks")', D=d) == "2026-02-14"
    assert val('dateAdd(prop("D"), 3, "days")', D=d) == "2026-02-03"
    assert val('dateSubtract(prop("D"), 31, "days")', D=d) == "2025-12-31"
    assert val('dateAdd(prop("D"), 90, "minutes")', D=d) == "2026-01-31T01:30:00.000Z"
    assert val('dateAdd(now(), 2, "hours")') == "2026-11-06T00:30:00.000Z"
    assert "Unknown unit" in err('dateAdd(now(), 1, "fortnights")')
    assert "dateAdd takes a date" in err('dateAdd("x", 1, "days")')
    assert ev('dateAdd(prop("N"), 1, "days")', N=None)["type"] == "empty"


def test_date_between():
    a = FDate(date(2026, 3, 15))
    b = FDate(date(2026, 1, 20))
    assert val('dateBetween(prop("A"), prop("B"), "days")', A=a, B=b) == 54
    assert val('dateBetween(prop("A"), prop("B"), "weeks")', A=a, B=b) == 7
    assert val('dateBetween(prop("A"), prop("B"), "months")', A=a, B=b) == 1  # 15th < 20th
    assert val('dateBetween(prop("B"), prop("A"), "months")', A=a, B=b) == -1
    assert val('dateBetween(prop("A"), prop("B"), "years")', A=a, B=b) == 0
    assert val('dateBetween(now(), prop("B"), "hours")', B=FDate(date(2026, 11, 5))) == 22
    assert val('dateBetween(today(), prop("B"), "days")', B=FDate(date(2026, 11, 1))) == 4


def test_date_parts_and_format():
    t = FDate(datetime(2026, 11, 6, 2, 5, tzinfo=UTC))
    assert val('year(prop("T"))', T=t) == 2026
    assert val('month(prop("T"))', T=t) == 11
    assert val('day(prop("T"))', T=t) == 6
    # Local parts: at UTC-5 it is still the 5th, 21:05.
    assert ev('day(prop("T"))', tz=EST, T=t)["value"] == 5
    assert val('formatDate(prop("T"), "DD/MM/YYYY HH:mm")', T=t) == "06/11/2026 02:05"
    assert ev('formatDate(prop("T"), "YYYY-MM-DD at HH:mm")', tz=EST, T=t)["value"] == (
        "2026-11-05 at 21:05"
    )
    assert val('formatDate(prop("D"), "MM.DD")', D=FDate(date(2026, 2, 3))) == "02.03"


def test_date_comparisons():
    a, b = FDate(date(2026, 1, 1)), FDate(date(2026, 2, 1))
    assert val('prop("A") < prop("B")', A=a, B=b) is True
    assert val('prop("A") == prop("A")', A=a) is True
    assert val('max(prop("A"), prop("B"))', A=a, B=b) == "2026-02-01"
    assert val('prop("A") < today()', A=a) is True


# -- references and renames ----------------------------------------------------------------------


def test_references():
    node = parse('prop("A") + prop("B") * prop("A") + if(prop("C"), 1, 2)')
    assert references(node) == ["A", "B", "C"]
    assert references(parse('"prop(\\"X\\")"')) == []


def test_rename_references():
    src = 'prop("Old")  +  prop( "Other" ) + "prop(\\"Old\\")"'
    out = rename_references(src, lambda n: "New" if n == "Old" else None)
    assert out == 'prop("New")  +  prop( "Other" ) + "prop(\\"Old\\")"'
    swapped = rename_references(
        'prop("A") - prop("B")', lambda n: {"A": "B", "B": "A"}.get(n)
    )
    assert swapped == 'prop("B") - prop("A")'
    assert rename_references('prop("A")', lambda n: 'Say "hi"') == 'prop("Say \\"hi\\"")'
    assert rename_references('"unterminated', lambda n: "x") == '"unterminated'
