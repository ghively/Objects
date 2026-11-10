"""M29 Task 2: type suggestion and name patterns (`objectapp.typesuggest`).

The parity fixture `frontend/src/create/__fixtures__/suggest-cases.json` is shared with the
TypeScript port's test (`frontend/src/create/typeSuggest.test.ts`): both run every row.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from objectapp.typemodel import TypeDefinition
from objectapp.typesuggest import (
    SuggestContext,
    compile_pattern,
    matches,
    pattern_problems,
    suggest_type,
)

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "create"
    / "__fixtures__"
    / "suggest-cases.json"
)

STARTER = {
    "host": ["{ip}", "{fqdn}", "SRV-*", "@@##", "@@@##", "@@@@##", "@*-##"],
    "network": ["{cidr}"],
    "software": ["{version}"],
}


def _type(tid: str, patterns: list | None = None) -> TypeDefinition:
    data: dict = {"id": tid, "name": tid.title(), "schemaVersion": 2}
    if patterns:
        data["namePatterns"] = patterns
    return TypeDefinition.from_json(data)


def _starter_types() -> list[TypeDefinition]:
    return [
        _type("host", STARTER["host"]),
        _type("network", STARTER["network"]),
        _type("software", STARTER["software"]),
        _type("application"),
        _type("runbook"),
        _type("page"),
    ]


def _ctx(types, **kw) -> SuggestContext:
    return SuggestContext(types=types, **kw)


def test_parity_cases():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    types = [_type(t["id"], t["namePatterns"]) for t in data["types"]]
    assert len(data["cases"]) >= 40
    for case in data["cases"]:
        ctx = case["ctx"]
        got = suggest_type(
            case["name"],
            SuggestContext(
                types=types,
                allowed=ctx.get("allowed") or (),
                scope=ctx.get("scope") or (),
                last=ctx.get("last"),
            ),
        )
        assert got == case["expect"], case
    for row in data["patterns"]:
        p = row["pattern"]
        assert (compile_pattern(p) is not None) is row["valid"], row
        for name in row["matches"]:
            assert matches(name, [p]), (p, name)
        for name in row["misses"]:
            assert not matches(name, [p]), (p, name)


def test_starter_patterns():
    types = _starter_types()
    for name in (
        "APP01",
        "SRV-02",
        "SRV-web",
        "10.20.0.5",
        "fe80::1",
        "app01.example.test",
        "PRN-TEST-01",
    ):
        assert suggest_type(name, _ctx(types)) == ["host"], name
    assert suggest_type("10.20.0.0/24", _ctx(types)) == ["network"]
    for name in ("SQL Server 2019", "Python 3.12", "7-Zip 23.01"):
        assert suggest_type(name, _ctx(types)) == ["software"], name
    for name in ("Line 3 printer", "README.md", "example.test", "Office365", "Meeting 2026-11-09"):
        assert suggest_type(name, _ctx(types)) == [], name


def test_context_first():
    types = _starter_types()
    assert suggest_type("APP01", _ctx(types, allowed=["software"])) == ["software"]
    assert suggest_type("APP01", _ctx(types, allowed=["host", "application"])) == [
        "host",
        "application",
    ]
    assert suggest_type("Payroll", _ctx(types, allowed=["host", "application"])) == [
        "host",
        "application",
    ]
    assert suggest_type("APP01", _ctx(types, scope=["network"])) == ["network"]
    # allowed beats scope
    assert suggest_type("APP01", _ctx(types, allowed=["software"], scope=["network"])) == [
        "software"
    ]
    # an allowed id that isn't offered is dropped
    assert suggest_type("APP01", _ctx(types, allowed=["ghost", "software"])) == ["software"]


def test_last_type_fallback():
    types = _starter_types()
    assert suggest_type("Payroll", _ctx(types, last="runbook")) == ["runbook"]
    assert suggest_type("APP01", _ctx(types, last="runbook")) == ["host", "runbook"]
    # a last type that isn't offered (deleted, read-only) is no suggestion
    assert suggest_type("Payroll", _ctx(types, last="deleted")) == []
    assert suggest_type("Payroll", _ctx(types, last=None)) == []


def test_bad_patterns_are_ignored_and_refused_on_save():
    for bad in ("{foo}", "a{ip}", "", "x" * 101, "abc\\"):
        assert compile_pattern(bad) is None, bad
    assert matches("APP01", ["{foo}", 5, None, "@@@##"]) is True  # type: ignore[list-item]
    assert matches("APP01", "@@@##") is False  # type: ignore[arg-type]
    assert matches("APP01", None) is False  # type: ignore[arg-type]

    # Several `*`s never backtrack: matching stays linear in the name's length.
    for name in ("a" * 5000 + "!", "a" * 5000, "a@" * 2500 + "#!"):
        start = time.perf_counter()
        assert matches(name, ["*@*@*@*@*@*#"]) is False
        assert time.perf_counter() - start < 0.05, name[:20]
    start = time.perf_counter()
    assert matches("(" + "a" * 5000 + ")", ["(a+)+$"]) is False
    assert matches(" " * 5000 + "x 1" + "1" * 5000 + "!", ["{version}"]) is False
    assert matches("a." * 2500 + "1", ["{fqdn}"]) is False
    assert time.perf_counter() - start < 0.05

    assert pattern_problems(["{foo}"]) == [
        "\"{foo}\" isn't a name pattern. Use *, ?, #, @ or one of {ip}, {cidr}, {fqdn}, {version}."
    ]
    assert pattern_problems([f"SRV-{i}*" for i in range(21)]) == [
        "A type can have at most 20 name patterns."
    ]
    assert pattern_problems(["x" * 101]) == ["A name pattern is at most 100 characters."]
    assert pattern_problems("x")
    assert pattern_problems([1])
    assert pattern_problems([""])
    assert pattern_problems(["abc\\"])
    assert pattern_problems([]) == []
    assert pattern_problems(None) == []
    assert pattern_problems(STARTER["host"]) == []
    assert pattern_problems(["x" * 100, "(a+)+$", "\\##"]) == []


def test_case_and_spaces():
    types = _starter_types()
    assert suggest_type("  app01 ", _ctx(types)) == ["host"]
    assert suggest_type("srv-02", _ctx(types)) == ["host"]


def test_glob_edges():
    # `*` and `?` never match a space; a literal space in a pattern matches one.
    assert matches("SRV-02", ["*"])
    assert not matches("two words", ["*"])
    assert matches("", ["*"])
    assert matches("two words", ["* *"])
    assert not matches("two  words", ["* *"])
    assert matches("ax ay b", ["*x *y *"])
    assert not matches("a b", ["a?b"])
    # `@` is a letter a-z only; `#` an ASCII digit only
    assert not matches("é1", ["@#"])
    assert not matches("a١", ["@#"])  # ARABIC-INDIC DIGIT ONE
    assert matches("A1", ["@#"])
    # escapes: the next character is literal
    assert matches("@1", ["\\@#"])
    assert not matches("a1", ["\\@#"])
    assert matches("a?", ["a\\?"])
    assert not matches("ab", ["a\\?"])
    assert matches("a\\b", ["a\\\\b"])
    # tokens need the whole pattern
    assert compile_pattern("{IP}") is None
    assert compile_pattern("{ip}") is not None
    assert compile_pattern("\\{") is None
