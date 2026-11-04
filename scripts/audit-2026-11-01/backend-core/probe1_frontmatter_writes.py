"""Audit probe 1: frontmatter edge cases and write-path safety on a copy of space-sample.

Run: uv run python scripts/audit-2026-11-01/backend-core/probe1_frontmatter_writes.py
Each check prints PASS/FAIL (FAIL = a suspected bug reproduced).
"""
from __future__ import annotations

import os
import shutil
import stat
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))

from objectapp import frontmatter as fmm  # noqa: E402
from objectapp.frontmatter import FrontmatterError, set_keys, parse_fm, replace_in_value, rename_key  # noqa: E402
from objectapp.space import Space, version_of, safe_filename  # noqa: E402
from objectapp.typedefs import read_raw  # noqa: E402

FIX = Path(__file__).resolve().parents[3] / "backend/tests/fixtures/space-sample"
SCRATCH = Path("/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/core/p1")


def fresh() -> Path:
    if SCRATCH.exists():
        shutil.rmtree(SCRATCH)
    shutil.copytree(FIX, SCRATCH)
    return SCRATCH


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {detail}" if detail else ""))


def run(name, fn):
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL {name} -- raised {type(exc).__name__}: {exc}")
        traceback.print_exc(limit=3)


# 1. lone surrogate (JSON "\udc80") in a property value
def t_surrogate_dc80():
    root = fresh()
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    try:
        sp.update_properties("Pages/Alpha.md", {"note": "bad \udc80 byte"}, v)
    except Exception as exc:  # noqa: BLE001
        check("surrogate dc80 refused cleanly", True, f"{type(exc).__name__}: {exc}")
        return
    raw = read_raw(root, "Pages/Alpha.md")
    data = (root / "Pages/Alpha.md").read_bytes()
    check("surrogate dc80 did not corrupt the file", not raw.readOnly,
          f"readOnly={raw.readOnly} reason={raw.readOnlyReason!r} bytes={data[-40:]!r}")


# 1b. non-escape surrogate (JSON "\ud83d") -> ?
def t_surrogate_d83d():
    root = fresh()
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    try:
        sp.update_properties("Pages/Alpha.md", {"note": "half emoji \ud83d"}, v)
        check("surrogate d83d handled", True, "written?")
    except Exception as exc:  # noqa: BLE001
        check("surrogate d83d gives a clean error (not 500)", isinstance(exc, ValueError) and not isinstance(exc, UnicodeError),
              f"{type(exc).__name__}: {exc}")


# 1c. lone surrogate in a title (rename) -> file name with raw byte
def t_surrogate_title():
    root = fresh()
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    try:
        res = sp.rename_object("Pages/Alpha.md", "Alpha \udc80", v)
        p = root / res.path
        check("surrogate title: file still valid utf-8", not read_raw(root, res.path).readOnly, f"path={res.path!r} exists={p.exists()}")
    except Exception as exc:  # noqa: BLE001
        check("surrogate title refused cleanly", isinstance(exc, ValueError), f"{type(exc).__name__}: {exc}")


# 2. duplicate keys
def t_duplicate_keys():
    try:
        parse_fm("a: 1\na: 2\n")
        check("duplicate keys raise FrontmatterError", False, "parsed without error")
    except FrontmatterError as exc:
        check("duplicate keys raise FrontmatterError", True, str(exc)[:60])
    except Exception as exc:  # noqa: BLE001
        check("duplicate keys raise FrontmatterError", False, f"{type(exc).__name__}")


# 3. merge key at top level
def t_merge_key():
    src = "base: &b\n  x: 1\n<<: *b\ntitle: T\n"
    try:
        out = set_keys(src, {"lastUpdated": "2026-01-01T00:00:00.000Z"})
        check("merge key: set_keys works", True, repr(out))
    except Exception as exc:  # noqa: BLE001
        check("merge key: set_keys raises FrontmatterError (not KeyError)", isinstance(exc, FrontmatterError), f"{type(exc).__name__}: {exc}")


# 4. property key '<<' from API makes file unreadable?
def t_merge_key_from_api():
    root = fresh()
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    try:
        sp.update_properties("Pages/Alpha.md", {"<<": "x"}, v)
    except Exception as exc:  # noqa: BLE001
        check("key '<<' refused", True, f"{type(exc).__name__}: {exc}")
        return
    raw = read_raw(root, "Pages/Alpha.md")
    check("key '<<' did not make the object read-only", not raw.readOnly, f"{raw.readOnlyReason} src={raw.of.frontmatter_src!r}")


def t_odd_keys():
    root = fresh()
    sp = Space(root)
    for key in ["", "a: b", "- x", "#c", "&anc", "*ali", "!tag", "?", "a\nb", "'q'", "x ", "null", "123", "true", "[a]", "{a}", "a b", "\udc80"]:
        _, _, v = sp.read("Pages/Alpha.md")
        try:
            sp.update_properties("Pages/Alpha.md", {key: "val"}, v)
        except Exception as exc:  # noqa: BLE001
            if isinstance(exc, (ValueError,)):
                continue
            check(f"odd key {key!r} -> clean error", False, f"{type(exc).__name__}: {exc}")
            continue
        raw = read_raw(root, "Pages/Alpha.md")
        if raw.readOnly:
            check(f"odd key {key!r} keeps the file readable", False, f"{raw.readOnlyReason} src={raw.of.frontmatter_src!r}")
            continue
        if raw.fm.get(key) != "val":
            check(f"odd key {key!r} round-trips", False, f"got {raw.fm.get(key)!r} keys={list(raw.fm)}")


def t_odd_values():
    root = fresh()
    sp = Space(root)
    vals = ["a\rb", "a b", "a\u0085b", " lead", "trail ", "\t", "#", "a #c", ": x", "- x", "'", '"', "x" * 5000,
            "line1\nline2", "\n", "null", "~", "yes", "1e3", "0x10", "1_000", "2026-01-01", "2026-13-45T99:99:99Z",
            "{creation:day}", "[a, b]", "{a: 1}", "&a", "*a", "!!str x", "%x", "@x", "`x", "|", ">", "a\x00b", "\x1b[31m", "﻿bom"]
    for val in vals:
        _, _, v = sp.read("Pages/Alpha.md")
        try:
            sp.update_properties("Pages/Alpha.md", {"note": val}, v)
        except Exception as exc:  # noqa: BLE001
            if isinstance(exc, ValueError):
                continue
            check(f"odd value {val[:20]!r} -> clean error", False, f"{type(exc).__name__}: {exc}")
            continue
        raw = read_raw(root, "Pages/Alpha.md")
        if raw.readOnly:
            check(f"odd value {val[:20]!r} keeps the file readable", False, f"{raw.readOnlyReason}")
            continue
        got = raw.fm.get("note")
        if got != val:
            check(f"odd value {val[:20]!r} round-trips", False, f"got {got!r}")
        # other keys intact?
        if raw.fm.get("createdAt") != "2026-04-01T08:00:00.000Z" or raw.fm.get("type") != "Page":
            check(f"odd value {val[:20]!r} leaves other keys", False, f"fm={raw.fm}")


# 5. heading inside a code fence renamed
def t_heading_in_code():
    root = fresh()
    p = root / "Pages/Alpha.md"
    p.write_text("---\ntype: 'Page'\ntitle: Alpha\n---\n\n```sh\n# Alpha\necho hi\n```\n\nText\n", encoding="utf-8")
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    res = sp.rename_object("Pages/Alpha.md", "Beta", v)
    body = (root / res.path).read_text(encoding="utf-8")
    check("rename leaves a '# Title' line inside a code block alone", "# Alpha\necho hi" in body, body.split("---\n")[-1][:80].replace("\n", "|"))


# 6. file mode preserved by atomic_write
def t_mode_preserved():
    root = fresh()
    p = root / "Pages/Alpha.md"
    os.chmod(p, 0o664)
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    sp.save_body("Pages/Alpha.md", "new body\n", v)
    mode = stat.S_IMODE(p.stat().st_mode)
    check("file mode preserved across a save (0664)", mode == 0o664, oct(mode))


# 7. lone \r in a value
def t_lone_cr():
    src = "title: a\rb\ncreatedAt: 2026-01-01T00:00:00.000Z\n"
    try:
        data = parse_fm(src)
        out = set_keys(src, {"lastUpdated": "x"})
        after = parse_fm(out)
        check("lone CR: other keys kept", after.get("createdAt") == "2026-01-01T00:00:00.000Z", repr(out))
    except FrontmatterError as exc:
        check("lone CR: parse error (file read-only)", True, str(exc)[:80])


# 8. non-string top-level keys with set_keys
def t_nonstring_keys():
    for src in ["1: x\ntitle: T\n", "true: x\ntitle: T\n", "null: x\ntitle: T\n", "2026-01-01: x\ntitle: T\n", "? [a, b]\n: c\ntitle: T\n", "1.5: x\ntitle: T\n"]:
        try:
            out = set_keys(src, {"lastUpdated": "s"})
            after = parse_fm(out)
            check(f"nonstring key {src.splitlines()[0]!r}: keys kept", "title" in after and after.get("lastUpdated") == "s", repr(out))
        except FrontmatterError as exc:
            print(f"INFO nonstring key {src.splitlines()[0]!r}: FrontmatterError {str(exc)[:60]}")
        except Exception as exc:  # noqa: BLE001
            check(f"nonstring key {src.splitlines()[0]!r}: no crash", False, f"{type(exc).__name__}: {exc}")


# 9. flow-mapping frontmatter, comments, anchors spans
def t_misc_src():
    cases = {
        "indented comment kept": "title: T\n  # a note under title\ncreatedAt: 2026-01-01\n",
        "comment at col0 between keys": "title: T\n# a note\ncreatedAt: 2026-01-01\n",
        "value then blank then comment": "title: T\n\n# a note\ncreatedAt: 2026-01-01\n",
        "folded value": "title: >\n  a\n  b\ncreatedAt: 2026-01-01\n",
        "literal with --- inside?": "title: T\ndesc: |\n  x\n  y\ncreatedAt: 2026-01-01\n",
        "tab indent": "title: T\nlist:\n\t- a\ncreatedAt: 2026-01-01\n",
        "doc start marker": "--- \ntitle: T\n",
        "directive": "%YAML 1.2\n---\ntitle: T\n",
        "trailing spaces key": "title : T\ncreatedAt: 2026-01-01\n",
        "crlf src": "title: T\r\ncreatedAt: 2026-01-01\r\n",
    }
    for name, src in cases.items():
        try:
            out = set_keys(src, {"title": "New"})
            after = parse_fm(out)
            ok = after.get("title") == "New" and all(k in after for k in parse_fm(src) if k != "title")
            check(f"set_keys {name}", ok, repr(out))
        except FrontmatterError as exc:
            print(f"INFO set_keys {name}: FrontmatterError {str(exc)[:70]}")
        except Exception as exc:  # noqa: BLE001
            check(f"set_keys {name}: no crash", False, f"{type(exc).__name__}: {exc}")


# 10. replace_in_value / rename_key odd forms
def t_replace_forms():
    cases = [
        ("tags: [a, b] # c\n", "tags"),
        ("tags:\n  - a   # c\n  - b\n", "tags"),
        ("owner: [[Alpha]]\n", "owner"),
        ("owner: '[[Alpha]]'\n", "owner"),
        ("owner: \"[[Alpha]]\"\n", "owner"),
        ("owner: |\n  [[Alpha]]\n  x\n", "owner"),
        ("owner: >-\n  [[Alpha]]\n  x\n", "owner"),
        ("owner: Alpha\n  continued\n", "owner"),
        ("owner: !!str Alpha\n", "owner"),
        ("owner: &x Alpha\nother: *x\n", "owner"),
        ("owner: {a: Alpha}\n", "owner"),
        ("owner:\n  - {a: Alpha}\n", "owner"),
        ("owner: [Alpha, [Alpha]]\n", "owner"),
        ("owner: 'it''s Alpha'\n", "owner"),
        ("owner: \"Alpha\\n\"\n", "owner"),
        ("owner: Alpha\r\n", "owner"),
    ]
    for src, key in cases:
        try:
            out = replace_in_value(src, key, lambda s: s.replace("Alpha", "Beta"))
            after = parse_fm(out)
            before = parse_fm(src)
            exp = fmm._map_strings(before[key], lambda s: s.replace("Alpha", "Beta"))
            check(f"replace_in_value {src.strip()[:30]!r}", after.get(key) == exp and after.keys() == before.keys(), repr(out))
        except FrontmatterError as exc:
            print(f"INFO replace_in_value {src.strip()[:30]!r}: FrontmatterError {str(exc)[:60]}")
        except Exception as exc:  # noqa: BLE001
            check(f"replace_in_value {src.strip()[:30]!r}: no crash", False, f"{type(exc).__name__}: {exc}")
    for src in ["'a b': 1\nc: 2\n", "\"a\\tb\": 1\nc: 2\n", "a: 1\nc: 2\n", "? a\n: 1\nc: 2\n", "a   : 1\nc: 2\n"]:
        try:
            out = rename_key(src, "a", "z")
            after = parse_fm(out)
            check(f"rename_key {src.splitlines()[0]!r}", after.get("z") == 1 and after.get("c") == 2 and "a" not in after, repr(out))
        except Exception as exc:  # noqa: BLE001
            check(f"rename_key {src.splitlines()[0]!r}: no crash", False, f"{type(exc).__name__}: {exc}")


# 11. empty / odd whole files
def t_odd_files():
    root = fresh()
    cases = {
        "empty.md": b"",
        "only-fence.md": b"---\n",
        "two-fences.md": b"---\n---\n",
        "fence-blank-fence.md": b"---\n\n---\n",
        "fence-nonl.md": b"---\ntitle: X\n---",
        "bom-crlf.md": b"\xef\xbb\xbf---\r\ntitle: X\r\n---\r\nbody\r\n",
        "only-comment.md": b"---\n# c\n---\nbody",
        "hr-body.md": b"---\n\nintro\n\n---\n\nmore\n",
        "nul.md": b"---\ntitle: a\x00b\n---\n",
        "huge-title.md": b"---\ntitle: " + b"x" * 200000 + b"\n---\n",
        "scalar-fm.md": b"---\njust text\n---\n",
        "list-fm.md": b"---\n- a\n---\n",
        "latin1.md": b"---\ntitle: caf\xe9\n---\n",
        "deep.md": b"---\na: " + b"[" * 2000 + b"]" * 2000 + b"\n---\n",
        "anchor-bomb.md": b"---\na: &a [x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c]\ne: &e [*d, *d, *d, *d, *d, *d, *d, *d, *d]\nf: &f [*e, *e, *e, *e, *e, *e, *e, *e, *e]\n---\n",
    }
    for name, data in cases.items():
        (root / "Pages" / name).write_bytes(data)
    import time
    t0 = time.perf_counter()
    sp = Space(root)
    dt = time.perf_counter() - t0
    print(f"INFO open with odd files took {dt:.2f}s")
    for name, data in cases.items():
        rel = f"Pages/{name}"
        before = (root / rel).read_bytes()
        try:
            s = sp.get(rel)
            _, _, v = sp.read(rel)
            try:
                sp.save_body(rel, "new body\n", v)
            except Exception as exc:  # noqa: BLE001
                if not isinstance(exc, (ValueError,)) and type(exc).__name__ not in ("ReadOnly",):
                    check(f"{name}: save gives clean error", False, f"{type(exc).__name__}: {exc}")
                else:
                    print(f"INFO {name}: save refused {type(exc).__name__}: {str(exc)[:60]}")
                    if (root / rel).read_bytes() != before:
                        check(f"{name}: refused save left bytes", False)
                continue
            after = read_raw(root, rel)
            if after.readOnly:
                check(f"{name}: saved file still readable", False, after.readOnlyReason)
            if after.of.body != "new body\n":
                check(f"{name}: body saved", False, repr(after.of.body[:60]))
            # body-only edit must keep every frontmatter key
            bfm = read_raw(root, rel) and parse_fm(read_raw(root, rel).of.frontmatter_src or "")
        except Exception as exc:  # noqa: BLE001
            check(f"{name}: no crash", False, f"{type(exc).__name__}: {exc}")


# 12. write-on-read: open + read everything, nothing outside .object changes
def t_write_on_read():
    root = fresh()
    def snap():
        return {str(p.relative_to(root)): version_of(p.read_bytes()) for p in root.rglob("*") if p.is_file() and ".object" not in p.parts}
    before = snap()
    sp = Space(root)
    sp.list(); [sp.read(s.path) for s in sp.list()]
    for s in sp.list():
        sp.backlinks(s.path); sp.outgoing(s.path)
    sp.rows(); sp.list_collections(); sp.list_queries(); sp.list_trash(); sp.daily_notes()
    for t in sp.types:
        try:
            sp.list_templates(t.id)
        except Exception:  # noqa: BLE001
            pass
    sp.types_with_revisions()
    sp.calendar("2026-10-01", "2026-10-31")
    after = snap()
    check("open+read writes no .md", before == after, str({k for k in before if before[k] != after.get(k)} | (set(after) - set(before))))


for name, fn in list(globals().items()):
    if name.startswith("t_") and callable(fn):
        print(f"--- {name}")
        run(name, fn)
