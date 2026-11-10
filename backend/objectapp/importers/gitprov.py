"""M31 item 4: git provenance for an import whose source folder is inside a git repository (import
design section 1's table, the "Wiki (git)" row: the url is the repo's web page for the file at the
commit when the repo has a known web remote, the version the commit sha, the author and date the
file's last commit's).

`repo_of` answers a `GitRepo` for a source folder inside a repository whose HEAD is a commit, else
None (no git, no repository, no commit yet, or git refused). It runs a handful of read-only git
commands once per source (`vcs.run` with ``read_only``: ``GIT_OPTIONAL_LOCKS=0`` so ``git status``
never writes the index; ``core.fsmonitor`` off so no hook program starts); none touches the network
and none changes the repository. Git's own ownership check stays on (M31 fix pass): a repository
that belongs to another user is refused by git (it could name filter programs that ``git status``
would run), and the folder is then imported as a plain folder, with `OTHER_OWNER` in the preview's
warnings and the report (`refused`, `note_for_read`).

- The commit is the repository's HEAD sha.
- `web_link` builds the link for an ``origin`` remote on GitHub, GitLab, Bitbucket or Azure DevOps
  (https, ssh and scp-like remotes; a user name or password in the remote is never copied). Any
  other host (a self-hosted server, a local path) has no link.
- A file is **uncommitted** when it differs from HEAD: modified, staged, or not tracked at all
  (``git status``, ignored files counted as not tracked).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING
from urllib.parse import quote, urlsplit

if TYPE_CHECKING:
    from .readmodel import ReadResult

__all__ = ["OTHER_OWNER", "GitRepo", "find_top", "note_for_read", "refused", "repo_for_read", "repo_of", "web_link"]

OTHER_OWNER = "This folder's git repository belongs to another user, so its commits were not read."
"""M31 fix pass: the preview's warning and the report's line when git refuses the repository (our string)."""
_DUBIOUS = re.compile(r"dubious ownership|safe\.directory", re.IGNORECASE)


_LOG_TIMEOUT = 120.0
_SEP = "\x01"


@dataclass
class GitRepo:
    top: Path
    head: str
    prefix: str
    """The source folder's path inside the repository (POSIX, ``""`` at the top)."""
    remote: str | None
    tracked: set[str] = field(default_factory=set)
    """Repository paths of the files in HEAD under the source folder."""
    dirty: set[str] = field(default_factory=set)
    """Repository paths that differ from HEAD (modified, staged, untracked, deleted)."""
    last: dict[str, tuple[str, str]] = field(default_factory=dict)
    """Repository path -> (author, ISO date) of the last commit that changed it."""

    def repo_path(self, source_rel: str) -> str:
        return f"{self.prefix}/{source_rel}" if self.prefix else source_rel

    def committed(self, source_rel: str) -> bool:
        return self.repo_path(source_rel) in self.tracked

    def uncommitted(self, source_rel: str) -> bool:
        rp = self.repo_path(source_rel)
        return rp in self.dirty or rp not in self.tracked

    def url(self, source_rel: str) -> str | None:
        if self.remote is None or not self.committed(source_rel):
            return None
        return web_link(self.remote, self.head, self.repo_path(source_rel))

    def last_commit(self, source_rel: str) -> tuple[str, str] | None:
        return self.last.get(self.repo_path(source_rel))


def find_top(folder: Path) -> Path | None:
    """The nearest folder at or above ``folder`` that holds a ``.git`` (a folder, or a file for a
    worktree or submodule); never runs git."""
    try:
        here = folder.resolve()
    except OSError:
        return None
    for p in (here, *here.parents):
        try:
            if (p / ".git").exists():
                return p
        except OSError:
            return None
    return None


_CONFIG = ["core.fsmonitor=false"]
"""No ``safe.directory``: git's check of who owns the repository is never switched off."""


def _unquote(path: str) -> str:
    from .. import vcs

    return vcs._unquote(path)


def repo_of(folder: str | Path) -> GitRepo | None:
    """The repository ``folder`` is in, read once (see the module doc), or None."""
    return _read(folder)[0]


def refused(folder: str | Path) -> bool:
    """Whether git refused the repository ``folder`` is in because another user owns it."""
    return _read(folder)[1]


def _read(folder: str | Path) -> tuple[GitRepo | None, bool]:
    """(the repository, or None; whether git refused it as another user's)."""
    from .. import vcs

    top = find_top(Path(folder))
    if top is None or not vcs.available():
        return None, False
    cfg = list(_CONFIG)

    def git(args: list[str], timeout: float = vcs.DEFAULT_TIMEOUT):
        return vcs.run(top, args, read_only=True, check=False, config=cfg, timeout=timeout)

    try:
        res = git(["rev-parse", "--show-toplevel"])
        if res.code != 0:
            return None, bool(_DUBIOUS.search(res.err or ""))
        shown = vcs._text(res.out).strip()
        if shown:
            top = Path(shown).resolve()
        res = git(["rev-parse", "--verify", "-q", "HEAD"])
        head = vcs._text(res.out).strip()
        if res.code != 0 or not re.fullmatch(r"[0-9a-f]{40}([0-9a-f]{24})?", head):
            return None, bool(_DUBIOUS.search(res.err or ""))
        try:
            prefix = Path(folder).resolve().relative_to(top).as_posix()
        except ValueError:
            return None, False
        prefix = "" if prefix == "." else prefix
        spec = ["--", prefix] if prefix else []
        res = git(["config", "--get", "remote.origin.url"])
        remote = vcs._text(res.out).strip() if res.code == 0 else ""
        repo = GitRepo(top=top, head=head, prefix=prefix, remote=remote or None)
        res = git(["ls-tree", "-r", "-z", "--name-only", "--full-tree", "HEAD", *spec])
        if res.code == 0:
            repo.tracked = {p.decode("utf-8", errors="replace") for p in res.out.split(b"\0") if p}
        res = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", *spec])
        if res.code == 0:
            for item in res.out.split(b"\0"):
                if len(item) > 3:
                    repo.dirty.add(item[3:].decode("utf-8", errors="replace"))
        res = git(["log", "--no-renames", f"--format={_SEP}%an%x00%aI", "--name-only", "HEAD", *spec],
                  timeout=_LOG_TIMEOUT)
        if res.code == 0:
            current: tuple[str, str] | None = None
            for line in vcs._text(res.out).splitlines():
                if line.startswith(_SEP):
                    author, _, date = line[1:].partition("\0")
                    current = (author.strip(), date.strip())
                elif line and current is not None:
                    repo.last.setdefault(_unquote(line), current)
        return repo, False
    except (vcs.GitMissing, vcs.GitFailed, OSError):
        return None, False


def _for_read(read: ReadResult) -> tuple[GitRepo | None, bool]:
    if read.container != "folder":
        return None, False
    cache = read.__dict__.get("_git_repo")
    if cache is not None and cache[0] == str(read.sourcePath):
        return cache[1], cache[2]
    got = _read(read.sourcePath) if os.path.isdir(str(read.sourcePath)) else (None, False)
    read.__dict__["_git_repo"] = (str(read.sourcePath), *got)
    return got


def repo_for_read(read: ReadResult) -> GitRepo | None:
    """`repo_of` for a folder source (cached on the read), None for a zip."""
    return _for_read(read)[0]


def note_for_read(read: ReadResult) -> str | None:
    """`OTHER_OWNER` when git refused the folder source's repository as another user's, else None."""
    return OTHER_OWNER if _for_read(read)[1] else None


# -- the web link -----------------------------------------------------------------------------


def _parse_remote(remote: str) -> tuple[str, str] | None:
    """(host, path) of a remote url: ``https://[user@]host[:port]/path``, ``ssh://...`` or scp-like
    ``[user@]host:path``; None for a local path or another scheme."""
    r = remote.strip()
    if "://" in r:
        parts = urlsplit(r)
        if parts.scheme.lower() not in ("http", "https", "ssh", "git", "git+ssh", "ssh+git"):
            return None
        host = (parts.hostname or "").lower()
        path = parts.path
    else:
        m = re.fullmatch(r"(?:[^@/\s]+@)?([A-Za-z0-9.-]+):(?!//)(.+)", r)
        if not m:
            return None
        host, path = m.group(1).lower(), m.group(2)
    path = path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return (host, path) if host and path else None


def _segments(path: str) -> str:
    return "/".join(quote(s, safe="") for s in PurePosixPath(path).parts)


def web_link(remote: str, sha: str, repo_path: str) -> str | None:
    """The web page of ``repo_path`` at commit ``sha`` for a GitHub, GitLab, Bitbucket or Azure
    DevOps remote, else None."""
    parsed = _parse_remote(remote)
    if parsed is None:
        return None
    host, path = parsed
    parts = [p for p in path.split("/") if p]
    file_part = _segments(repo_path)
    if host.startswith("www."):
        host = host[4:]
    if host == "github.com" and len(parts) == 2:
        return f"https://github.com/{parts[0]}/{parts[1]}/blob/{sha}/{file_part}"
    if host == "gitlab.com" and len(parts) >= 2:
        return f"https://gitlab.com/{'/'.join(parts)}/-/blob/{sha}/{file_part}"
    if host == "bitbucket.org" and len(parts) == 2:
        return f"https://bitbucket.org/{parts[0]}/{parts[1]}/src/{sha}/{file_part}"
    query = f"?path={quote('/' + repo_path, safe='/')}&version=GC{sha}"
    if host == "ssh.dev.azure.com" and len(parts) == 4 and parts[0] == "v3":
        org, project, repo = parts[1:]
        return f"https://dev.azure.com/{org}/{project}/_git/{repo}{query}"
    if host == "dev.azure.com" and len(parts) == 4 and parts[2] == "_git":
        org, project, _git, repo = parts
        return f"https://dev.azure.com/{org}/{project}/_git/{repo}{query}"
    if host == "vs-ssh.visualstudio.com" and len(parts) == 4 and parts[0] == "v3":
        org, project, repo = parts[1:]
        return f"https://{org}.visualstudio.com/{project}/_git/{repo}{query}"
    if host.endswith(".visualstudio.com") and "_git" in parts:
        i = parts.index("_git")
        if i >= 1 and i == len(parts) - 2:
            return f"https://{host}/{'/'.join(parts[:i])}/_git/{parts[i + 1]}{query}"
    return None
