"""M18 Task 3: skills, usage and Undo (``agentskills``, ``learnundo``).

An agent folder made with M17's ``agentfiles.write_skeleton`` in ``tmp_path``; ``OBJECT_STATE_DIR``
is a temp folder (conftest). Fixtures are synthetic.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from objectapp import agentfiles, agentskills, ledger, learnundo
from objectapp.agentmemory import apply as memory_apply
from objectapp.agentskills import (
    MEMO,
    SkillConflict,
    SkillInvalid,
    SkillNotFound,
    SkillTooLarge,
    archive,
    list_skills,
    manage,
    record_use,
    restore,
    safe_support_path,
    set_pinned,
    set_state,
    user_create,
    user_write,
    view,
)
from objectapp.learningmodel import ARCHIVE_DIR, LEARNING_DEFAULTS, MEMORY_FILE, SKILLS_DIR, USAGE_FILE
from objectapp.learnundo import UndoConflict, undo

CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"
SOURCE = {"kind": "chat", "agentId": "assistant", "chatId": CHAT, "run": None}
CURATOR = {"kind": "curator", "agentId": "assistant", "chatId": None, "run": "01KCURATORRUNAAAAAAAAAAAAA"}
USER = {"kind": "user"}
UNDO = {"kind": "undo", "agentId": "assistant"}
PATH_MESSAGE = "Support files go in references/, templates/ or scripts/."
CURATOR_MESSAGE = "The curator doesn't change pinned skills or skills you wrote."


@pytest.fixture(autouse=True)
def fresh_memo() -> Any:
    """Memo keys are run token ids in real use; the tests reuse short ones, so each starts clean."""
    MEMO._read.clear()
    MEMO._used.clear()
    yield
    MEMO._read.clear()
    MEMO._used.clear()


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    f = tmp_path / "agent"
    agentfiles.write_skeleton(f, {"v": 1, "name": "Assistant"}, "Be helpful.")
    return f


def _create(folder: Path, name: str = "rack-labels", key: str = "run0", **kw: Any) -> dict[str, Any]:
    return manage(folder, "create", name=name, source=kw.pop("source", SOURCE), memo_key=key,
                  description=kw.pop("description", "Label racks"),
                  content=kw.pop("content", "# Steps\nPrint the label.\n"), **kw)


def _skill_md(folder: Path, name: str = "rack-labels") -> Path:
    return folder / SKILLS_DIR / name / "SKILL.md"


def _text(path: Path) -> str:
    return path.read_bytes().decode("utf-8")


def _hand_skill(folder: Path, name: str, front: str = "") -> None:
    d = folder / SKILLS_DIR / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_bytes(f"---\nname: {name}\ndescription: Hand made\n{front}---\nBody\n".encode())


def _info(folder: Path, name: str, archived: bool = False) -> Any:
    return next(s for s in list_skills(folder, archived=archived) if s.name == name)


def _all_entries(folder: Path) -> list[dict[str, Any]]:
    return ledger.entries(folder, limit=1000)


def _usage(folder: Path) -> dict[str, Any]:
    return json.loads((folder / USAGE_FILE).read_text("utf-8"))


def _patch(folder: Path, key: str, old: str = "Print the label.", new: str = "Print two labels.",
           **kw: Any) -> dict[str, Any]:
    return manage(folder, "patch", name=kw.pop("name", "rack-labels"), source=kw.pop("source", SOURCE),
                  memo_key=key, old_string=old, new_string=new, **kw)


def test_create_marks_agent(folder: Path) -> None:
    out = _create(folder)
    assert out["ok"] is True and out["entryId"]
    text = _text(_skill_md(folder))
    assert text.startswith("---\nname: rack-labels\ndescription: Label racks\ncreated_by: agent\n---\n")
    assert text.endswith("# Steps\nPrint the label.\n")
    info = _info(folder, "rack-labels")
    assert info.state == "active" and info.created_by == "agent" and info.uses == 0
    assert info.to_api()["createdBy"] == "agent"
    entry = ledger.get(folder, out["entryId"])
    assert entry["action"] == "create" and entry["before"] is None and entry["after"] == text
    assert entry["skill"] == "rack-labels" and entry["file"] == "SKILL.md"
    assert out["skill"]["name"] == "rack-labels"


def test_user_skills(folder: Path) -> None:
    _hand_skill(folder, "by-hand")
    assert _info(folder, "by-hand").created_by == "user"
    out = user_create(folder, "gene-skill", "Mine", "Do it my way.\n")
    text = _text(_skill_md(folder, "gene-skill"))
    assert "created_by" not in text
    assert _info(folder, "gene-skill").created_by == "user"
    assert out["createdBy"] == "user" and out["text"] == text
    assert ledger.get(folder, out["entryId"])["source"]["kind"] == "user"


def test_patch_needs_a_read_in_this_run(folder: Path) -> None:
    _create(folder, key="run0")
    with pytest.raises(SkillInvalid, match=r"Read the skill with skill_view first \(in this run\), then change it\."):
        _patch(folder, "run1")
    view(folder, "rack-labels", memo_key="run1")
    _patch(folder, "run1")
    with pytest.raises(SkillInvalid, match="Read the skill"):
        _patch(folder, "run2", old="two", new="three")
    MEMO.forget("run1")
    with pytest.raises(SkillInvalid, match="Read the skill"):
        _patch(folder, "run1", old="two", new="three")
    record_use(folder, "rack-labels", "run3")
    _patch(folder, "run3", old="two", new="three")
    _create(folder, name="fresh", key="run4")
    _patch(folder, "run4", name="fresh")


def test_patch_rules(folder: Path) -> None:
    _create(folder, content="qq x qq\n")
    view(folder, "rack-labels", memo_key="r")
    with pytest.raises(SkillInvalid, match="That text isn't in SKILL.md."):
        _patch(folder, "r", old="zzz", new="y")
    with pytest.raises(SkillInvalid, match="That text is in SKILL.md 2 times; give more of it or set replace_all."):
        _patch(folder, "r", old="qq", new="b")
    _patch(folder, "r", old="qq", new="b", replace_all=True)
    assert _text(_skill_md(folder)).endswith("b x b\n")
    before = _text(_skill_md(folder))
    with pytest.raises(SkillInvalid, match="SKILL.md must keep its front matter with name 'rack-labels' and a description."):
        _patch(folder, "r", old="name: rack-labels\n", new="")
    assert _text(_skill_md(folder)) == before
    _patch(folder, "r", old="created_by: agent\n", new="")
    assert "created_by: agent" in _text(_skill_md(folder))
    assert _info(folder, "rack-labels").created_by == "agent"


def test_limits(folder: Path) -> None:
    with pytest.raises(SkillInvalid, match="A skill name is at most 64 characters"):
        _create(folder, name="a" * 65)
    _create(folder, name="a" * 64)
    with pytest.raises(SkillInvalid, match="A skill's description is 1 to 60 characters."):
        _create(folder, name="desc", description="d" * 61)
    with pytest.raises(SkillInvalid, match="A skill's description is 1 to 60 characters."):
        _create(folder, name="desc", description="")
    _create(folder)
    view(folder, "rack-labels", memo_key="r")
    head = "---\nname: rack-labels\ndescription: Label racks\ncreated_by: agent\n---\n"
    with pytest.raises(SkillTooLarge) as too_big:
        manage(folder, "edit", name="rack-labels", source=SOURCE, memo_key="r",
               content=head + "x" * (100_001 - len(head)))
    assert too_big.value.status == 413 and too_big.value.message == "SKILL.md can be at most 100,000 characters."
    manage(folder, "edit", name="rack-labels", source=SOURCE, memo_key="r",
           content=head + "é" * (100_000 - len(head)))
    assert len(_skill_md(folder).read_bytes().decode("utf-8")) == 100_000
    with pytest.raises(SkillTooLarge, match="A skill's files can be at most 1 MiB each."):
        manage(folder, "write_file", name="rack-labels", source=SOURCE, memo_key="r",
               file="references/big.md", content="x" * 1_048_577)
    manage(folder, "write_file", name="rack-labels", source=SOURCE, memo_key="r",
           file="references/big.md", content="x" * 1_048_576)
    assert (folder / SKILLS_DIR / "rack-labels" / "references" / "big.md").stat().st_size == 1_048_576


def test_bad_paths_and_names_are_refused(folder: Path) -> None:
    _create(folder)
    skill_dir = folder / SKILLS_DIR / "rack-labels"
    before = sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*"))
    for bad in ("../x.md", "C:/x.md", "/x.md", "references\\x.md", "SKILL.md", "notes/x.md",
                "references/con.md", "references/../../x.md", "references", "references/"):
        with pytest.raises(SkillInvalid, match=PATH_MESSAGE):
            manage(folder, "write_file", name="rack-labels", source=SOURCE, memo_key="r", file=bad, content="x")
        with pytest.raises(SkillInvalid):
            safe_support_path(skill_dir, bad)
    after = sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*"))
    assert after == before
    for name in ("Rack", "a b", "-x", "../x"):
        with pytest.raises(SkillInvalid, match="A skill name is at most 64 characters"):
            _create(folder, name=name)
    assert safe_support_path(skill_dir, "templates/a/b.txt") == skill_dir / "templates" / "a" / "b.txt"


def _link_dir(link: Path, target: Path) -> bool:
    try:
        os.symlink(target, link, target_is_directory=True)
        return True
    except (OSError, NotImplementedError):
        pass
    if sys.platform == "win32":
        done = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)],
                              capture_output=True, check=False)
        return done.returncode == 0 and link.exists()
    return False


def test_no_write_through_a_link(folder: Path, tmp_path: Path) -> None:
    _create(folder)
    space = tmp_path / "space"
    space.mkdir()
    if not _link_dir(folder / SKILLS_DIR / "rack-labels" / "references", space):
        pytest.skip("no permission to make a link")
    with pytest.raises(SkillInvalid, match=PATH_MESSAGE):
        manage(folder, "write_file", name="rack-labels", source=SOURCE, memo_key="r",
               file="references/x.md", content="x")
    assert list(space.iterdir()) == []


def test_view_bumps_usage_once_per_run(folder: Path) -> None:
    _create(folder)
    view(folder, "rack-labels", memo_key="r")
    view(folder, "rack-labels", memo_key="r")
    assert _info(folder, "rack-labels").uses == 1
    out = view(folder, "rack-labels", memo_key="s")
    info = _info(folder, "rack-labels")
    assert info.uses == 2 and info.last_used
    assert out["file"] == "SKILL.md" and out["text"] == _text(_skill_md(folder))
    assert out["files"][0]["path"] == "SKILL.md"
    mtime = (folder / USAGE_FILE).stat().st_mtime_ns
    view(folder, "rack-labels", memo_key="t", bump=False)
    assert (folder / USAGE_FILE).stat().st_mtime_ns == mtime and _info(folder, "rack-labels").uses == 2
    set_state(folder, "rack-labels", "stale", source=CURATOR)
    count = len(_all_entries(folder))
    view(folder, "rack-labels", memo_key="u")
    assert _info(folder, "rack-labels").state == "active"
    assert len(_all_entries(folder)) == count


def test_archive_and_restore(folder: Path) -> None:
    _create(folder)
    _create(folder, name="broader")
    out = archive(folder, "rack-labels", source=SOURCE, absorbed_into="broader")
    assert (folder / ARCHIVE_DIR / "rack-labels" / "SKILL.md").is_file()
    assert not (folder / SKILLS_DIR / "rack-labels").exists()
    assert out["skill"]["state"] == "archived" and out["skill"]["absorbedInto"] == "broader"
    names = [s.name for s in list_skills(folder)]
    assert names == ["broader"]
    archived = _info(folder, "rack-labels", archived=True)
    assert archived.state == "archived" and archived.absorbed_into == "broader"
    assert ledger.get(folder, out["entryId"])["absorbedInto"] == "broader"
    back = restore(folder, "rack-labels", source=USER)
    assert back["skill"]["state"] == "active" and back["skill"]["absorbedInto"] is None
    assert _skill_md(folder).is_file() and not (folder / ARCHIVE_DIR / "rack-labels").exists()
    undo(folder, back["entryId"], source=UNDO)
    assert (folder / ARCHIVE_DIR / "rack-labels" / "SKILL.md").is_file() and not _skill_md(folder).exists()


def test_archive_and_restore_collisions(folder: Path) -> None:
    _create(folder)
    archive(folder, "rack-labels", source=SOURCE)
    with pytest.raises(SkillConflict, match="A skill named 'rack-labels' already exists."):
        _create(folder)
    _hand_skill(folder, "rack-labels")
    out = archive(folder, "rack-labels", source=USER)
    assert out["skill"]["name"] == "rack-labels (2)"
    assert (folder / ARCHIVE_DIR / "rack-labels (2)" / "SKILL.md").is_file()
    _hand_skill(folder, "rack-labels")
    with pytest.raises(SkillConflict, match="A skill with this name is active.") as conflict:
        restore(folder, "rack-labels", source=USER)
    assert conflict.value.status == 409
    assert (folder / ARCHIVE_DIR / "rack-labels").is_dir()


def test_absorbed_into_must_exist(folder: Path) -> None:
    _create(folder)
    with pytest.raises(SkillInvalid, match="There's no active skill named 'nope'."):
        manage(folder, "archive", name="rack-labels", source=SOURCE, memo_key="r", absorbed_into="nope")
    with pytest.raises(SkillNotFound) as missing:
        manage(folder, "remove_file", name="rack-labels", source=SOURCE, memo_key="r", file="references/none.md")
    assert missing.value.status == 404
    with pytest.raises(SkillNotFound, match="There's no active skill named 'ghost'."):
        manage(folder, "archive", name="ghost", source=SOURCE, memo_key="r")


def test_curator_source_spares_protected(folder: Path) -> None:
    _create(folder, name="pinned-one")
    set_pinned(folder, "pinned-one", True, source=USER)
    _hand_skill(folder, "gene-made", "created_by: user\n")
    for name in ("pinned-one", "gene-made"):
        view(folder, name, memo_key="c")
        with pytest.raises(SkillInvalid, match=CURATOR_MESSAGE):
            manage(folder, "archive", name=name, source=CURATOR, memo_key="c")
        with pytest.raises(SkillInvalid, match=CURATOR_MESSAGE):
            _patch(folder, "c", name=name, old="Body", new="Text", source=CURATOR)
        with pytest.raises(SkillInvalid, match=CURATOR_MESSAGE):
            archive(folder, name, source=CURATOR)
    view(folder, "gene-made", memo_key="u")
    _patch(folder, "u", name="gene-made", old="Body", new="Text")
    manage(folder, "archive", name="pinned-one", source=SOURCE, memo_key="u")
    manage(folder, "archive", name="gene-made", source=SOURCE, memo_key="u")


def test_curator_spares_schedule_skills(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _create(folder)
    monkeypatch.setattr(agentskills, "SCHEDULE_SKILLS", lambda f: {"rack-labels"})
    with pytest.raises(SkillInvalid, match="The curator doesn't change skills a schedule uses."):
        manage(folder, "archive", name="rack-labels", source=CURATOR, memo_key="c")

    def broken(f: Path) -> set[str]:
        raise OSError("index unreadable")

    monkeypatch.setattr(agentskills, "SCHEDULE_SKILLS", broken)
    with pytest.raises(SkillInvalid, match="The curator doesn't change skills a schedule uses."):
        manage(folder, "archive", name="rack-labels", source=CURATOR, memo_key="c")
    manage(folder, "archive", name="rack-labels", source=SOURCE, memo_key="c")


def test_pin_and_state(folder: Path) -> None:
    _create(folder)
    (folder / USAGE_FILE).write_text(json.dumps({"v": 1, "extra": {"keep": 1}, "skills": {
        "rack-labels": {"uses": 0, "mine": "kept"}}}), "utf-8")
    count = len(_all_entries(folder))
    pinned = set_pinned(folder, "rack-labels", True, source=USER)
    assert pinned["skill"]["pinned"] is True
    stale = set_state(folder, "rack-labels", "stale", source=CURATOR)
    assert stale["skill"]["state"] == "stale"
    usage = _usage(folder)
    assert usage["extra"] == {"keep": 1} and usage["skills"]["rack-labels"]["mine"] == "kept"
    assert usage["skills"]["rack-labels"]["pinned"] is True and usage["skills"]["rack-labels"]["state"] == "stale"
    actions = [e["action"] for e in _all_entries(folder)[: len(_all_entries(folder)) - count]]
    assert actions == ["stale", "pin"]


def test_list_never_writes(folder: Path) -> None:
    _hand_skill(folder, "by-hand")
    mtimes = {p: p.stat().st_mtime_ns for p in folder.rglob("*")}
    list_skills(folder)
    list_skills(folder, archived=True)
    view(folder, "by-hand", bump=False)
    view(folder, "by-hand", bump=False, memo_key="k")
    assert {p: p.stat().st_mtime_ns for p in folder.rglob("*")} == mtimes
    assert not (folder / USAGE_FILE).exists()


def _state(folder: Path) -> dict[str, Any]:
    """Every file under the skills, the archive and the memory folder, with its bytes, and the
    usage state that undo restores."""
    files = {}
    for root in (SKILLS_DIR, ARCHIVE_DIR, ".object-agent/memory"):
        base = folder / root
        if base.exists():
            for p in base.rglob("*"):
                if p.is_file():
                    files[p.relative_to(folder).as_posix()] = p.read_bytes()
    usage = json.loads((folder / USAGE_FILE).read_text("utf-8")) if (folder / USAGE_FILE).exists() else {}
    skills = {k: (v.get("pinned", False), v.get("state", "active")) for k, v in usage.get("skills", {}).items()}
    return {"files": files, "skills": {k: v for k, v in skills.items() if v != (False, "active")}}


def test_undo_each_action(folder: Path) -> None:
    _create(folder, key="r")
    _create(folder, name="other", key="r")
    skill = folder / SKILLS_DIR / "rack-labels"
    (skill / "scripts").mkdir()
    binary = bytes(range(256)) * 4
    (skill / "scripts" / "tool.bin").write_bytes(binary)
    steps = [
        lambda: _patch(folder, "r"),
        lambda: manage(folder, "edit", name="rack-labels", source=SOURCE, memo_key="r",
                       content="---\nname: rack-labels\ndescription: Label racks\n---\nNew body\n"),
        lambda: manage(folder, "write_file", name="rack-labels", source=SOURCE, memo_key="r",
                       file="references/a.md", content="ref\n"),
        lambda: manage(folder, "remove_file", name="rack-labels", source=SOURCE, memo_key="r",
                       file="scripts/tool.bin"),
        lambda: manage(folder, "archive", name="other", source=SOURCE, memo_key="r"),
        lambda: set_pinned(folder, "rack-labels", True, source=USER),
        lambda: set_state(folder, "rack-labels", "stale", source=CURATOR),
        lambda: memory_apply(folder, "add", "memory", content="Rack A is in room 2", old_text=None,
                             source=SOURCE, caps=dict(LEARNING_DEFAULTS)),
    ]
    memory_apply(folder, "add", "memory", content="Base fact", old_text=None, source=SOURCE,
                 caps=dict(LEARNING_DEFAULTS))
    view(folder, "rack-labels", memo_key="r")
    for step in steps:
        before = _state(folder)
        out = step()
        assert _state(folder) != before
        entry = _all_entries(folder)[0]
        assert entry["id"] == out["entryId"]
        made = undo(folder, entry["id"], source=UNDO)
        assert made["action"] == "undo" and made["undoes"] == entry["id"]
        assert _state(folder) == before, entry["action"]
        assert ledger.line(ledger.get(folder, made["id"])).startswith("Undid: ")
        if entry["action"] == "remove_file":
            assert entry["encoding"] == "base64"
            assert base64.b64decode(entry["before"]) == binary
            assert (skill / "scripts" / "tool.bin").read_bytes() == binary
    first = _all_entries(folder)[-1]
    assert first["action"] == "create" and first["skill"] == "rack-labels"


@pytest.mark.parametrize("data", [
    b"\xef\xbb\xbfref one\r\nref two\r\n",
    b"ref one\r\nref two\r\n",
    b"\xef\xbb\xbfref\n",
])
def test_undo_remove_file_keeps_bom_and_crlf(folder: Path, data: bytes) -> None:
    _create(folder, key="r")
    path = folder / SKILLS_DIR / "rack-labels" / "references" / "a.md"
    path.parent.mkdir()
    path.write_bytes(data)
    out = manage(folder, "remove_file", name="rack-labels", source=SOURCE, memo_key="r", file="references/a.md")
    assert not path.exists()
    undo(folder, out["entryId"], source=UNDO)
    assert path.read_bytes() == data


def test_remove_file_plain_text_stays_text(folder: Path) -> None:
    _create(folder, key="r")
    path = folder / SKILLS_DIR / "rack-labels" / "references" / "a.md"
    path.parent.mkdir()
    path.write_bytes(b"ref\n")
    out = manage(folder, "remove_file", name="rack-labels", source=SOURCE, memo_key="r", file="references/a.md")
    entry = ledger.get(folder, out["entryId"])
    assert entry["encoding"] == "text" and entry["before"] == "ref\n"


def test_undo_refuses_when_changed_since(folder: Path) -> None:
    _create(folder)
    view(folder, "rack-labels", memo_key="r")
    patched = _patch(folder, "r")
    current = view(folder, "rack-labels", bump=False)
    user_write(folder, "rack-labels", "SKILL.md", current["text"] + "Gene's line\n", current["revision"])
    before = _state(folder)
    count = len(_all_entries(folder))
    with pytest.raises(UndoConflict, match="This changed again since. Undo the later change first.") as conflict:
        undo(folder, patched["entryId"], source=UNDO)
    assert conflict.value.status == 409
    assert _state(folder) == before and len(_all_entries(folder)) == count


def test_undo_of_undo_and_of_create(folder: Path) -> None:
    created = _create(folder)
    first = undo(folder, created["entryId"], source=UNDO)
    assert not (folder / SKILLS_DIR / "rack-labels").exists()
    assert (folder / ARCHIVE_DIR / "rack-labels" / "SKILL.md").is_file()
    undo(folder, first["id"], source=UNDO)
    assert _skill_md(folder).is_file() and not (folder / ARCHIVE_DIR / "rack-labels").exists()

    caps = dict(LEARNING_DEFAULTS)
    memory_apply(folder, "add", "memory", content="one", old_text=None, source=SOURCE, caps=caps)
    memory_apply(folder, "add", "memory", content="two", old_text=None, source=SOURCE, caps=caps)
    removed = memory_apply(folder, "remove", "memory", content=None, old_text="two", source=SOURCE, caps=caps)
    mem = folder / MEMORY_FILE
    assert _text(mem) == "one"
    back = undo(folder, removed["entryId"], source=UNDO)
    assert _text(mem) == "one\n§\ntwo"
    undo(folder, back["id"], source=UNDO)
    assert _text(mem) == "one"


def test_undo_archive_name_taken(folder: Path) -> None:
    _create(folder)
    archived = archive(folder, "rack-labels", source=SOURCE)
    _hand_skill(folder, "rack-labels")
    with pytest.raises(UndoConflict):
        undo(folder, archived["entryId"], source=UNDO)
    assert (folder / ARCHIVE_DIR / "rack-labels").is_dir()


def test_undo_of_curator_archive(folder: Path) -> None:
    _create(folder)
    archived = archive(folder, "rack-labels", source=CURATOR)
    undo(folder, archived["entryId"], source=UNDO)
    assert _skill_md(folder).is_file()


def test_undo_unknown_entry(folder: Path) -> None:
    with pytest.raises(KeyError):
        undo(folder, "01KNOPEAAAAAAAAAAAAAAAAAAA", source=UNDO)


def test_user_write_revision(folder: Path) -> None:
    _create(folder)
    with pytest.raises(SkillConflict) as conflict:
        user_write(folder, "rack-labels", "SKILL.md", "x", "stale")
    assert conflict.value.status == 409 and conflict.value.current_revision == _info(folder, "rack-labels").revision
    out = user_write(folder, "rack-labels", "references/a.md", "note\n", None)
    assert out["revision"] and ledger.get(folder, out["entryId"])["action"] == "write_file"
    assert ledger.get(folder, out["entryId"])["source"]["kind"] == "user"


def test_bom_and_crlf_kept(folder: Path) -> None:
    d = folder / SKILLS_DIR / "crlf-skill"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_bytes(b"\xef\xbb\xbf---\r\nname: crlf-skill\r\ndescription: X\r\n---\r\nOld line\r\n")
    view(folder, "crlf-skill", memo_key="r")
    _patch(folder, "r", name="crlf-skill", old="Old line", new="New line")
    raw = (d / "SKILL.md").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf") and b"New line\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")
