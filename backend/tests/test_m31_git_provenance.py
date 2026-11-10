"""M31 item 4: git provenance (import design section 1's table, the "Wiki (git)" row).

A synthetic wiki in a temporary git repository (committed as a fixed author and date, ``origin`` set
to a GitHub ssh remote, never fetched) is imported into a new, empty space. Each object's
``importSource`` says ``system: wiki``, the commit (HEAD's sha), the file's web page at that commit,
and the last commit's author and date; a file changed since the commit, and one never committed,
are marked ``uncommitted`` and listed in the report's Git section. The repository is never changed.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import snapshot, wait_job

from objectapp.frontmatter import parse_fm
from objectapp.importers import gitprov, provenance
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space

AUTHOR = "Ada Example"
DATE = "2026-10-01T09:30:00+00:00"
REMOTE = "git@github.com:acme/ops-wiki.git"


def _git(repo: Path, *args: str, date: str = DATE) -> str:
    env = {**os.environ, "GIT_AUTHOR_NAME": AUTHOR, "GIT_AUTHOR_EMAIL": "ada@example.invalid",
           "GIT_COMMITTER_NAME": AUTHOR, "GIT_COMMITTER_EMAIL": "ada@example.invalid",
           "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date}
    return subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main", *args],
                          cwd=repo, env=env, check=True, capture_output=True, text=True).stdout


def _wiki(tmp_path: Path) -> Path:
    """``repo/docs`` is the source folder: a subfolder of the repository, so links carry its path."""
    repo = tmp_path / "repo"
    (repo / "docs" / "Hosts").mkdir(parents=True)
    (repo / "README.md").write_text("Top.\n", encoding="utf-8")
    (repo / "docs" / "Home.md").write_text("# Home\n\nSee [[APP01]].\n", encoding="utf-8")
    (repo / "docs" / "Hosts" / "APP01.md").write_text("APP01 runs Payroll.\n", encoding="utf-8")
    (repo / "docs" / "Hosts" / "Old box.md").write_text("Retired.\n", encoding="utf-8")
    _git(repo, "init", "-q")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "first")
    (repo / "docs" / "Hosts" / "APP01.md").write_text("APP01 runs Payroll.\n\nMore.\n", encoding="utf-8")
    _git(repo, "add", "docs/Hosts/APP01.md")
    _git(repo, "commit", "-q", "-m", "second", date="2026-10-05T12:00:00+00:00")
    _git(repo, "remote", "add", "origin", REMOTE)
    (repo / "docs" / "Hosts" / "Old box.md").write_text("Retired in 2026.\n", encoding="utf-8")  # not committed
    (repo / "docs" / "Draft.md").write_text("Not in git yet.\n", encoding="utf-8")  # untracked
    return repo


def _import(client: TestClient, source: Path) -> dict:
    r = client.post("/api/import/preview", json={"source": {"path": str(source)}, "target": "currentSpace"})
    assert r.status_code == 200, r.text
    pv = r.json()
    r = client.post("/api/import/start", json={"previewId": pv["previewId"], "mapping": pv["mapping"],
                                               "target": {"kind": "currentSpace"}, "keepAsSources": False})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    return job["result"]


def _blocks(root: Path) -> dict[str, dict]:
    out = {}
    for p in sorted(root.rglob("*.md")):
        if ".object" in p.parts:
            continue
        text = p.read_text(encoding="utf-8")
        fm = parse_fm(text.split("---", 2)[1]) if text.startswith("---") else {}
        if isinstance(fm.get("importSource"), dict):
            out[fm["importSource"]["id"]] = fm["importSource"]
    return out


@pytest.fixture
def target(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    (tmp_path / "spaces").mkdir()
    root = create_space("Imported", tmp_path / "spaces")
    app = create_app(Space(root), watch=False)
    with TestClient(app) as client:
        yield root, client


def test_git_provenance(tmp_path: Path, target) -> None:
    root, client = target
    repo = _wiki(tmp_path)
    head = _git(repo, "rev-parse", "HEAD").strip()
    status_before = _git(repo, "status", "--porcelain", "--untracked-files=all")
    files_before = snapshot(repo)

    result = _import(client, repo / "docs")

    blocks = _blocks(root)
    home, app01, old, draft = (blocks[k] for k in ("Home.md", "Hosts/APP01.md", "Hosts/Old box.md", "Draft.md"))
    for b in blocks.values():
        assert b["system"] == "wiki"
    assert home["version"] == head
    assert home["url"] == f"https://github.com/acme/ops-wiki/blob/{head}/docs/Home.md"
    assert home["author"] == AUTHOR and home["modified"].startswith("2026-10-01T09:30:00")
    assert "uncommitted" not in home
    assert app01["url"] == f"https://github.com/acme/ops-wiki/blob/{head}/docs/Hosts/APP01.md"
    assert app01["modified"].startswith("2026-10-05T12:00:00")  # its last commit, not the first
    # Changed since the commit: still that commit's link and author, marked uncommitted.
    assert old["version"] == head and old["uncommitted"] is True
    assert old["url"] == f"https://github.com/acme/ops-wiki/blob/{head}/docs/Hosts/Old%20box.md"
    # Never committed: no commit, no web link; the file link and content hash as for any folder.
    assert draft["uncommitted"] is True
    assert draft["version"].startswith("sha256:") and draft["url"].startswith("file:")

    report = (root / result["reportPath"]).read_text(encoding="utf-8")
    assert "## Git" in report and f"- Imported at commit `{head}`." in report
    assert "(`Hosts/Old box.md`): has changes not committed to git; imported as it is on disk" in report
    assert "(`Draft.md`): has changes not committed to git" in report
    assert "(`Home.md`): has changes" not in report

    # The repository is never changed.
    assert snapshot(repo) == files_before
    assert _git(repo, "status", "--porcelain", "--untracked-files=all") == status_before


def test_rerun_of_an_earlier_markdown_import_finds_its_objects(tmp_path: Path, target) -> None:
    """A folder imported before it was in git (``system: markdown``) is matched on the re-run."""
    root, client = target
    src = tmp_path / "notes"
    src.mkdir()
    (src / "Alpha.md").write_text("Alpha.\n", encoding="utf-8")
    (src / "Beta.md").write_text("Beta.\n", encoding="utf-8")
    first = _import(client, src)
    assert first["objects"] == 2
    assert {b["system"] for b in _blocks(root).values()} == {"markdown"}
    _git(src, "init", "-q")
    _git(src, "add", "-A")
    _git(src, "commit", "-q", "-m", "now in git")
    again = _import(client, src)
    assert again["objects"] == 0
    md = [p for p in root.rglob("*.md") if ".object" not in p.parts and p.stem in ("Alpha", "Beta")]
    assert len(md) == 2  # none made twice
    report = (root / again["reportPath"]).read_text(encoding="utf-8")
    assert "no longer in the source" not in report


def test_no_repository_no_git_fields(tmp_path: Path) -> None:
    src = tmp_path / "plain"
    src.mkdir()
    assert gitprov.find_top(src) is None and gitprov.repo_of(src) is None
    assert "wiki" in provenance.SYSTEMS


@pytest.mark.parametrize(("remote", "want"), [
    ("git@github.com:acme/wiki.git", "https://github.com/acme/wiki/blob/SHA/a/B%20c.md"),
    ("https://github.com/acme/wiki", "https://github.com/acme/wiki/blob/SHA/a/B%20c.md"),
    ("https://user:secret@github.com/acme/wiki.git", "https://github.com/acme/wiki/blob/SHA/a/B%20c.md"),
    ("ssh://git@github.com:22/acme/wiki.git", "https://github.com/acme/wiki/blob/SHA/a/B%20c.md"),
    ("git@gitlab.com:group/sub/wiki.git", "https://gitlab.com/group/sub/wiki/-/blob/SHA/a/B%20c.md"),
    ("https://bitbucket.org/acme/wiki.git", "https://bitbucket.org/acme/wiki/src/SHA/a/B%20c.md"),
    ("git@bitbucket.org:acme/wiki.git", "https://bitbucket.org/acme/wiki/src/SHA/a/B%20c.md"),
    ("https://acme@dev.azure.com/acme/Ops/_git/wiki",
     "https://dev.azure.com/acme/Ops/_git/wiki?path=/a/B%20c.md&version=GCSHA"),
    ("git@ssh.dev.azure.com:v3/acme/Ops/wiki", "https://dev.azure.com/acme/Ops/_git/wiki?path=/a/B%20c.md&version=GCSHA"),
    ("https://acme.visualstudio.com/Ops/_git/wiki",
     "https://acme.visualstudio.com/Ops/_git/wiki?path=/a/B%20c.md&version=GCSHA"),
    ("https://git.example.internal/acme/wiki.git", None),
    ("/srv/git/wiki.git", None),
    ("file:///srv/git/wiki.git", None),
])
def test_web_link(remote: str, want: str | None) -> None:
    assert gitprov.web_link(remote, "SHA", "a/B c.md") == want
