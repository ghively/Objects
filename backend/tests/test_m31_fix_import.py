"""M31 fix pass, lane A: the import's own findings from the whole-milestone review.

1. The conventions in every space without false refusals (Gene's decision 1 stays): a look-alike
   is a new type sharing at least `proposal.LOOKALIKE_MIN_SHARED` specific properties (by name and
   kind, the common ones left out) with an existing type, `proposal.LOOKALIKE_SHARE` or more of
   both types' specific properties together; a relation to an existing or proposed type is kept;
   a category name blocks only when the item also looks like the type holding that category.
2. Git provenance never overrides git's ownership check: a repository git refuses (another user's)
   is imported as a plain folder, with a line in the preview and the report; reading provenance
   never writes ``.git/index``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from m30_helpers import itops_space
from test_m31_git_provenance import _blocks, _wiki

from objectapp import vcs
from objectapp.importers import batches, gitprov, proposal
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space


def _p(name: str, kind: str = "text", **extra) -> dict:
    return {"name": name, "kind": kind, "share": 1.0, **extra}


def _create(name: str, props: list[dict], iid: str) -> dict:
    return {"id": iid, "action": "create", "group": name, "name": name, "documents": 10,
            "examples": [f"Wiki/{name} 1.md"], "properties": props}


def _save(root: Path, *items: dict) -> tuple[str, list[dict]]:
    batch = batches.create_draft(root, "/x")
    stored = proposal.save_proposal(Space(root), batch, {"summary": "", "items": list(items)})
    return batch, stored["items"]


def _basic(tmp_path: Path) -> Path:
    return create_space("Basic", tmp_path, "basic")


# -- 1. the conventions without false refusals ---------------------------------------------------


def test_common_properties_never_make_a_lookalike(tmp_path: Path) -> None:
    """On a fresh basic space: [Notes, Type] and [Genre, Rating] are not Book, [Status, Notes] and
    [Status, Location] are not Project; Apply creates all four."""
    root = _basic(tmp_path)
    items = [
        _create("Edition", [_p("Notes"), _p("Type", "label", key="editionType", options=["Paper", "Cloth"])], "g1"),
        _create("Film", [_p("Genre", "label", options=["Drama"]), _p("Rating", "number")], "g2"),
        _create("Errand", [_p("Status", "label", options=["Open"]), _p("Notes")], "g3"),
        _create("Site", [_p("Status", "label", options=["Open"]), _p("Location")], "g4"),
    ]
    batch, saved = _save(root, *items)
    for it in saved:
        assert it["problems"] == [] and "offer" not in it, (it["name"], it["problems"])
    proposal.save_review(Space(root), batch, [{"id": it["id"], "status": "accepted"} for it in saved])
    out = proposal.apply(Space(root), batch)
    assert len(out["created"]) == 4 and out["skipped"] == []


def test_lookalike_needs_three_shared_and_the_share_of_both(tmp_path: Path) -> None:
    """Three of Book's specific properties (Authors, Genre, Rating, Reading timeline) are not
    enough on their own: the share is over both types' specific properties together."""
    space = Space(_basic(tmp_path))
    genre, rating = _p("Genre", "label", options=["Drama"]), _p("Rating", "number")
    timeline = _p("Reading timeline", "datetime")
    authors = _p("Authors", "entity", target="Person")
    assert proposal.lookalike([genre, rating], space) is None  # two shared
    assert proposal.lookalike([genre, rating, timeline], space) is None  # 3 of 4 together: 75%
    assert proposal.lookalike([genre, rating, timeline, authors], space).id == "book"  # 4 of 4
    assert proposal.lookalike([genre, rating, timeline, authors, _p("Pages", "number")], space).id == "book"  # 80%
    extra = [_p("Pages", "number"), _p("Publisher")]
    assert proposal.lookalike([genre, rating, timeline, authors, *extra], space) is None  # 4 of 6
    # by name and kind: Rating as text is not Book's Rating (a number)
    assert proposal.lookalike([genre, _p("Rating"), timeline, authors], space) is None
    # the common properties are left out on both sides
    common = [_p("Notes"), _p("Status", "label", options=["Open"]), _p("Description")]
    assert proposal.lookalike([genre, rating, timeline, authors, *common], space).id == "book"


HOST_LIKE = [
    _p("Category", "label", options=["Server"]), _p("Roles", "label", options=["DHCP"]),
    _p("IP address"), _p("FQDN"), _p("Department", "label", options=["IT"]),
    _p("Environment", "label", options=["Production"]),
    _p("Operating system", "entity", target="Software"), _p("Located at", "entity", target="Location"),
    _p("Network", "entity", target="Network"), _p("Owned by", "entity", target="Person"),
    _p("Last boot", "datetime"), _p("Disk free", "number"), _p("Patch state", "label", options=["Current"]),
    _p("Reboot pending", "boolean"), _p("Last seen", "datetime"),
]
"""Every specific property of the IT ops Host, by name and kind."""


def test_real_lookalike_still_refused(tmp_path: Path) -> None:
    root = itops_space(tmp_path)
    batch, (server, box) = _save(root, _create("Server", HOST_LIKE, "g1"), _create("Box", HOST_LIKE, "g2"))
    assert server["problems"][0] == "It has the same properties as Host."
    assert "Server is a category: a property value or a tag, not a type." in server["problems"]
    assert server["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Server"}
    assert box["problems"] == ["It has the same properties as Host."]
    assert box["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Box"}
    proposal.save_review(Space(root), batch, [{"id": "g1", "status": "accepted"}, {"id": "g2", "status": "accepted"}])
    out = proposal.apply(Space(root), batch)
    assert out["created"] == [] and {s["id"] for s in out["skipped"]} == {"g1", "g2"}


def test_relation_to_a_proposed_or_existing_type_is_kept(tmp_path: Path) -> None:
    """A Notion-style "Author" relation to a type proposed in the same proposal, and "Reviewer" to an
    existing one, are kept; one to a type that is neither stays a plain link."""
    root = _basic(tmp_path)
    article = _create("Article", [_p("Author", "entity", target="Writer"), _p("Reviewer", "entity", target="Person"),
                                  _p("Venue", "entity", target="Magazine"), _p("Word count", "number")], "g1")
    writer = _create("Writer", [_p("Born", "datetime"), _p("Country")], "g2")
    batch, (art, _w) = _save(root, article, writer)
    assert [p["name"] for p in art["properties"]] == ["Author", "Reviewer", "Word count"]
    assert art["dropped"] == [{"key": "venue", "name": "Venue",
                               "reason": "It points at Magazine, which is neither a type in this space nor one "
                                         "proposed here; it stays a plain link."}]
    assert art["problems"] == []
    proposal.save_review(Space(root), batch, [{"id": "g1", "status": "accepted"}, {"id": "g2", "status": "accepted"}])
    proposal.apply(Space(root), batch)
    space = Space(root)
    a = next(t for t in space.types if t.name == "Article")
    w = next(t for t in space.types if t.name == "Writer")
    assert a.prop("author").options["allowedTypes"] == [w.id]
    assert a.prop("reviewer").options["allowedTypes"] == ["person"]


def test_category_name_without_the_holders_properties_is_a_note(tmp_path: Path) -> None:
    """Workstation is an option of Host's Category; with properties of its own the item is not
    blocked: a note and the offer instead, and Apply creates it as proposed."""
    root = itops_space(tmp_path)
    own = [_p("Hypervisor version"), _p("Memory", "number")]
    like = [_p("IP address"), _p("FQDN"), _p("Memory", "number")]
    batch, (ws, kiosk) = _save(root, _create("Workstation", own, "g1"), _create("Production", like, "g2"))
    assert ws["problems"] == []
    assert ws["notes"] == ["Workstation is also one of Host's Category options."]
    assert ws["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Workstation"}
    # two of Host's specific properties: refused as before
    assert kiosk["problems"] == ["Production is a category: a property value or a tag, not a type."]
    assert kiosk["offer"]["typeId"] == "host" and "notes" not in kiosk
    group = proposal.view(Space(root), batch)["proposal"]["groups"][0]
    assert group["notes"] == ws["notes"] and group["offer"] == ws["offer"]
    proposal.save_review(Space(root), batch, [{"id": "g1", "status": "accepted"}, {"id": "g2", "status": "accepted"}])
    out = proposal.apply(Space(root), batch)
    assert [Space(root).type_by_id(t).name for t in out["created"]] == ["Workstation"]
    assert [s["id"] for s in out["skipped"]] == ["g2"]


# -- 2. git's ownership check stays on -----------------------------------------------------------


@pytest.fixture
def target(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    (tmp_path / "spaces").mkdir()
    root = create_space("Imported", tmp_path / "spaces")
    with TestClient(create_app(Space(root), watch=False)) as client:
        yield root, client


def _preview_and_import(client: TestClient, source: Path) -> tuple[dict, dict]:
    r = client.post("/api/import/preview", json={"source": {"path": str(source)}, "target": "currentSpace"})
    assert r.status_code == 200, r.text
    pv = r.json()
    r = client.post("/api/import/start", json={"previewId": pv["previewId"], "mapping": pv["mapping"],
                                               "target": {"kind": "currentSpace"}, "keepAsSources": False})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    return pv, job["result"]


def test_reading_provenance_never_writes_the_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _wiki(tmp_path)
    home = repo / "docs" / "Home.md"
    stamp = home.stat().st_mtime + 30
    os.utime(home, (stamp, stamp))  # same bytes, a newer time: a plain `git status` would refresh the index
    index = repo / ".git" / "index"
    before = (index.read_bytes(), index.stat().st_mtime_ns)
    configs: list[list[str]] = []
    real = vcs.run

    def spy(root, args, **kw):
        configs.append(list(kw.get("config") or []))
        return real(root, args, **kw)

    monkeypatch.setattr(vcs, "run", spy)
    found = gitprov.repo_of(repo / "docs")
    assert found is not None and found.head
    assert (index.read_bytes(), index.stat().st_mtime_ns) == before
    assert configs and not any(c.startswith("safe.directory") for cfg in configs for c in cfg)


def test_a_repository_git_refuses_is_a_plain_folder(tmp_path: Path, target, monkeypatch: pytest.MonkeyPatch) -> None:
    """Git refuses another user's repository ("dubious ownership"): no provenance, a plain Markdown
    import, and the preview and the report say why."""
    root, client = target
    repo = _wiki(tmp_path)
    real = vcs.run

    def refusing(where, args, **kw):
        if args[:1] == ["rev-parse"]:
            err = (f"fatal: detected dubious ownership in repository at '{where}'\n"
                   "To add an exception for this directory, call:\n")
            return vcs._Result(128, b"", err)
        return real(where, args, **kw)

    monkeypatch.setattr(vcs, "run", refusing)
    assert gitprov.repo_of(repo / "docs") is None
    assert gitprov.refused(repo / "docs") is True
    pv, result = _preview_and_import(client, repo / "docs")
    assert gitprov.OTHER_OWNER == ("This folder's git repository belongs to another user, so its commits "
                                   "were not read.")
    assert gitprov.OTHER_OWNER in pv["warnings"]
    blocks = _blocks(root)
    assert blocks and all(b["system"] == "markdown" and "uncommitted" not in b for b in blocks.values())
    report = (root / result["reportPath"]).read_text(encoding="utf-8")
    assert f"- {gitprov.OTHER_OWNER}" in report and "## Git" not in report


@pytest.mark.skipif(not hasattr(os, "geteuid") or os.geteuid() != 0 or shutil.which("git") is None,
                    reason="needs root to give the repository to another user")
def test_another_users_repository_is_refused_by_git(tmp_path: Path) -> None:
    """The real thing: the repository belongs to another user, and git's own check refuses it."""
    repo = _wiki(tmp_path)
    for dirpath, dirnames, filenames in os.walk(repo):
        for name in [*dirnames, *filenames]:
            os.chown(os.path.join(dirpath, name), 4242, 4242, follow_symlinks=False)
    os.chown(repo, 4242, 4242)
    probe = subprocess.run(["git", "config", "--global", "--get-all", "safe.directory"], capture_output=True,
                           text=True, check=False)
    if probe.stdout.strip():
        pytest.skip("this machine's git trusts other users' repositories (safe.directory)")
    assert gitprov.repo_of(repo / "docs") is None
    assert gitprov.refused(repo / "docs") is True
