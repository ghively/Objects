"""M24 Task 3: brain dumps, the Capture type, prefixes and filing outcomes (``captures``,
``api_captures``, ``api_v1_captures``, the ``file_capture`` tool)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_m23_api import PRINTER, Env, _git, _make

from objectapp import apiquery, captures, windowhost
from objectapp.agentmodel import AgentInput
from objectapp.agents import AgentRegistry
from objectapp.tokens import TokenStore
from objectapp.workloop import WorkLoop

BADGE = "Tasks/Badge reader audit.md"
CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    windowhost.set_opener(None)
    e = _make(tmp_path, monkeypatch)
    e.secrets = []  # type: ignore[attr-defined]
    e.agent = AgentRegistry().create(AgentInput(name="Work"), "Work.\n")  # type: ignore[attr-defined]
    yield e
    for s in e.secrets:  # type: ignore[attr-defined]
        TokenStore.drop_ephemeral(s)
    windowhost.set_opener(None)


def token(env: Env, purpose: str = "work-file", scope: str = "read-write") -> dict[str, str]:
    _r, secret = TokenStore(env.root).ephemeral("Work", scope, agent=env.agent.id, chat=CHAT, purpose=purpose)  # type: ignore[attr-defined]
    env.secrets.append(secret)  # type: ignore[attr-defined]
    return {"Authorization": f"Bearer {secret}"}


def dump(env: Env, text: str, **extra) -> dict:
    res = env.c.post("/api/work/captures", json={"text": text, "fromView": "now", **extra})
    assert res.status_code == 201, res.text
    return res.json()["capture"]


def file_(env: Env, cap: dict, outcome: str, headers=None, **body):
    return env.c.post("/api/v1/agent/work/file-capture", headers=headers or token(env),
                      json={"capture": cap["path"], "outcome": outcome, **body})


def text_of(env: Env, rel: str) -> bytes:
    return (env.root / rel).read_bytes()


def test_capture_type_made_once(env: Env) -> None:
    assert not (env.root / ".object/types/capture.json").exists()
    dump(env, "First one")
    path = env.root / ".object/types/capture.json"
    assert ("types", "capture", None) in env.events() or any(e[0] == "types" for e in env.events())
    data = json.loads(path.read_text(encoding="utf-8"))
    props = [p for p in data["propertyDefinitions"] if p["key"] in (
        "captureText", "capturedAt", "fromView", "linkedItem", "captureStatus", "filedTo", "question")]
    assert [(p["key"], p["name"], p["type"]) for p in props] == [
        ("captureText", "Text", "textBlock"), ("capturedAt", "Captured at", "datetime"),
        ("fromView", "From view", "text"), ("linkedItem", "Linked item", "entity"),
        ("captureStatus", "Status", "label"), ("filedTo", "Filed to", "entity"),
        ("question", "Question", "text")]
    status = next(p for p in props if p["key"] == "captureStatus")
    assert [(o["id"], o["text"], o["color"]) for o in status["options"]["set"]] == [
        ("new", "New", "pink"), ("filed", "Filed", "green"), ("needs-you", "Needs you", "amber")]
    assert data["name"] == "Capture" and data["pluralName"] == "Captures"
    before = path.read_bytes()
    dump(env, "Second one")
    assert path.read_bytes() == before


def test_capture_saved_first_and_never_deleted(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(self, *_a, **_k):
        raise RuntimeError("queue write failed")

    monkeypatch.setattr(WorkLoop, "enqueue_capture", boom)
    text = "Line one\r\nline two\n---\nsee [[Badge reader audit]]\n" + "x" * 5000
    cap = dump(env, text)
    assert cap["status"] == "new" and cap["text"] == text
    assert cap["capturedAt"] == "2026-11-05T10:00:00.000Z"
    assert (env.root / cap["path"]).is_file()
    trash_before = [t.id for t in env.space.list_trash()]
    paths = [cap["path"]]
    for outcome, body in (
        ("workNote", {"item": PRINTER, "text": "noted"}),
        ("step", {"item": PRINTER, "stepKind": "do", "stepText": "Check tray 2"}),
        ("task", {"taskTitle": "Buy rollers"}),
        ("fact", {"page": BADGE, "text": "Reader 4 is spare"}),
        ("needsYou", {"question": "Which printer?"}),
    ):
        c = dump(env, f"capture for {outcome}")
        paths.append(c["path"])
        res = file_(env, c, outcome, **body)
        assert res.status_code == 200, res.text
    assert all((env.root / p).is_file() for p in paths)
    assert [t.id for t in env.space.list_trash()] == trash_before
    again = file_(env, {"path": paths[1]}, "workNote", item=PRINTER, text="x")
    assert again.status_code == 409 and again.json()["detail"] == "This brain dump is already filed."
    c = dump(env, "needs a question")
    res = file_(env, c, "needsYou")
    assert res.status_code == 422 and res.json()["detail"] == "Say what you need to know."
    empty = env.c.post("/api/work/captures", json={"text": "  ", "fromView": "now"})
    assert empty.status_code == 422 and empty.json()["detail"] == "A brain dump needs text."
    big = env.c.post("/api/work/captures", json={"text": "x" * 8001, "fromView": "now"})
    assert big.status_code == 422 and big.json()["detail"] == "A brain dump is at most 8,000 characters."


def test_prefixes() -> None:
    p = captures.parse_prefix("Break down INC0012345 step 2: restart is too big")
    assert (p.route, p.item_ref, p.step_n) == ("breakDown", "INC0012345", 2)
    assert captures.parse_prefix("BREAKDOWN OPS-123 step 1: x").route == "breakDown"
    q = captures.parse_prefix("question about Printer jams on line 3: which tray?")
    assert (q.route, q.item_ref, q.rest) == ("question", "Printer jams on line 3", "which tray?")
    assert captures.parse_prefix("Question about nothing here").route == "file"
    assert captures.parse_prefix("just a thought").route == "file"


def test_prefix_routes_to_the_item(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list = []
    monkeypatch.setattr(WorkLoop, "enqueue_capture", lambda self, c, parsed, item: seen.append((c, parsed, item)))
    if True:
        a = dump(env, "Break down INC0012345 step 2: restart is too big")
        assert a["linkedPath"] == PRINTER and seen[-1][1].route == "breakDown" and seen[-1][1].step_n == 2
        b = dump(env, "Question about Badge reader audit: where?")
        assert b["linkedPath"] == BADGE and seen[-1][1].route == "question"
        c = dump(env, "Question about NOPE-1: who?")
        assert c["linkedPath"] is None and seen[-1][1].route == "file"
        d = dump(env, "Break down INC0012345 step 9: nope")
        assert seen[-1][1].route == "file" and d["text"].startswith("Break down")
        e = dump(env, "Question about Badge reader audit: where?", linkedPath=PRINTER)
        assert e["linkedPath"] == PRINTER


def test_outcomes(env: Env) -> None:
    c = dump(env, "Printer jam again")
    res = file_(env, c, "workNote", item=PRINTER, text="It jammed again")
    assert res.status_code == 200, res.text
    assert res.json()["capture"]["status"] == "filed" and res.json()["filedTo"] == PRINTER
    assert "[2026-11-05] Work: note: It jammed again" in text_of(env, PRINTER).decode()
    assert res.json()["capture"]["filedTo"]["path"] == PRINTER

    c = dump(env, "Add a check")
    res = file_(env, c, "step", item=PRINTER, stepKind="do", stepText="Check the tray sensor")
    assert res.status_code == 200, res.text
    assert text_of(env, PRINTER).decode().count("Check the tray sensor") >= 1
    c = dump(env, "Add approve")
    res = file_(env, c, "step", item=PRINTER, stepKind="approve", stepText="Reboot")
    assert res.status_code == 422 and res.json()["detail"] == "A brain dump adds no Approve step."

    c = dump(env, "Buy new rollers for line 3")
    res = file_(env, c, "task", taskTitle="Buy rollers")
    assert res.status_code == 200, res.text
    task = res.json()["filedTo"]
    assert "Buy new rollers for line 3" in text_of(env, task).decode()

    before = text_of(env, BADGE)
    assert before.startswith(b"\xef\xbb\xbf") and b"\r\n" in before
    c = dump(env, "Reader 4 is a spare")
    res = file_(env, c, "fact", page=BADGE, text="Reader 4 is a spare")
    assert res.status_code == 200, res.text
    after = text_of(env, BADGE)
    assert after.startswith(b"\xef\xbb\xbf") and b"## Notes" in after and b"Reader 4 is a spare" in after
    assert b"\n" not in after.replace(b"\r\n", b"")
    c = dump(env, "Another fact")
    assert file_(env, c, "fact", page=BADGE, text="Second fact").status_code == 200
    assert text_of(env, BADGE).count(b"## Notes") == 1

    c = dump(env, "Which printer?")
    res = file_(env, c, "needsYou", question="Which printer do you mean?")
    cap = res.json()["capture"]
    assert cap["status"] == "needsYou" and cap["question"] == "Which printer do you mean?"
    assert res.json()["filedTo"] is None


def test_file_capture_needs_a_filing_run(env: Env) -> None:
    c = dump(env, "hello")
    for purpose in ("work-read", "chat"):
        res = file_(env, c, "needsYou", headers=token(env, purpose), question="q")
        assert res.status_code == 403 and res.json()["detail"] == "This run can't file brain dumps."
    # an excluded page is 404
    _of, _fm, v = env.space.read(BADGE)
    env.space.update_properties(BADGE, {apiquery.EXCLUDE_KEY: True}, v)
    res = file_(env, c, "fact", page=BADGE, text="x")
    assert res.status_code == 404
    assert env.c.get("/api/work/captures").json()["captures"][0]["status"] == "new"


def test_reply_and_mark_filed(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    queued: list = []
    monkeypatch.setattr(WorkLoop, "enqueue_capture", lambda self, c, p, i: queued.append(c) or {})
    c = dump(env, "Check the printer")
    res = env.c.post("/api/work/captures/reply", json={"path": c["path"], "version": c["version"], "text": "x"})
    assert res.status_code == 422 and res.json()["detail"] == "This brain dump isn't waiting on you."
    asked = file_(env, c, "needsYou", question="Which?").json()["capture"]
    stale = env.c.post("/api/work/captures/reply", json={"path": c["path"], "version": c["version"], "text": "x"})
    assert stale.status_code == 409 and stale.json()["currentVersion"] == asked["version"]
    queued.clear()
    res = env.c.post("/api/work/captures/reply", json={"path": c["path"], "version": asked["version"], "text": "The big one"})
    assert res.status_code == 200, res.text
    got = res.json()["capture"]
    assert got["status"] == "new" and got["question"] is None
    assert got["text"] == "Check the printer\n\nReply: The big one"
    assert len(queued) == 1
    c2 = dump(env, "Other")
    before = text_of(env, c2["path"]).decode()
    res = env.c.post("/api/work/captures/mark-filed", json={"path": c2["path"], "version": c2["version"]})
    assert res.status_code == 200 and res.json()["capture"]["status"] == "filed"
    after = text_of(env, c2["path"]).decode()
    diff = [(a, b) for a, b in zip(before.splitlines(), after.splitlines()) if a != b]
    assert len(before.splitlines()) == len(after.splitlines())
    keys = {a.split(":")[0] for a, _b in diff}  # lastUpdated may keep the fixed clock's instant
    assert "captureStatus" in keys and keys <= {"captureStatus", "lastUpdated"}
    assert env.c.post("/api/work/captures/mark-filed", json={"path": c2["path"], "version": c2["version"]}).status_code == 409


def test_list_captures_writes_nothing(env: Env) -> None:
    a = dump(env, "one")
    b = dump(env, "two")
    file_(env, b, "needsYou", question="Which?")
    _git(env.root, "add", "-A")
    snapshot = env.status()
    state = env.state_files()
    res = env.c.get("/api/work/captures", params={"status": "needsYou"}).json()["captures"]
    assert [c["path"] for c in res] == [b["path"]]
    allc = env.c.get("/api/work/captures").json()["captures"]
    assert {c["path"] for c in allc} == {a["path"], b["path"]}
    assert env.status() == snapshot and env.state_files() == state


def test_file_capture_writes_the_capture_atomically(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """Sweep 2026-11-09: filing writes the brain dump through a temp file beside it and one replace
    (`Space._write`), so a crash at the replace leaves the old file whole and no temp file behind."""
    import os

    c = dump(env, "Check the printer")
    target = env.root / c["path"]
    before = target.read_bytes()
    entries = set(os.listdir(target.parent))
    real = os.replace

    def crash(src, dst, *a, **k):
        if Path(dst) == target:
            raise OSError("crash at the replace")
        return real(src, dst, *a, **k)

    monkeypatch.setattr(os, "replace", crash)
    res = file_(env, c, "needsYou", question="Which?")
    assert res.status_code == 503 and "crash at the replace" in res.json()["detail"]
    assert target.read_bytes() == before
    assert set(os.listdir(target.parent)) == entries  # no temp file left
    monkeypatch.setattr(os, "replace", real)
    res = file_(env, c, "needsYou", question="Which?")
    assert res.status_code == 200, res.text
    assert target.read_bytes() != before and b"Which?" in target.read_bytes()
    assert set(os.listdir(target.parent)) == entries
