"""Git plumbing for version control and backup (Gene, 2026-11-08: "the entire object workspace
gitbacked for backup to github or lab and version control and rollbacks").

Every git call goes through `run`: list arguments (never a shell), ``cwd`` pinned to the
repository's folder, a timeout on every call, and an environment that never waits on a person:
``GIT_TERMINAL_PROMPT=0`` (no username/password prompt), ``GIT_SSH_COMMAND`` with ``BatchMode``
when the user hasn't set one (no SSH passphrase prompt), ``GIT_OPTIONAL_LOCKS=0`` for the
read-only calls (``git status`` doesn't take the index lock) and ``GIT_LITERAL_PATHSPECS=1`` (a
file named ``*.md`` is that file, not a glob). Object never stores a git token or password: a
remote authenticates with the system's credential helper or SSH agent, or not at all.

The rules this module keeps (the safety list in the design note,
``docs/superpowers/specs/2026-11-08-git-backed-spaces-design.md``):

- Staging is by explicit path, taken from ``git status --porcelain -z``; never ``git add -A``
  over the whole tree. An entry another tool staged (the index differs from HEAD for a path
  Object didn't stage) is left exactly as it is and reported; the commit is made with
  ``git commit --only`` over Object's own paths, so those entries stay staged.
- ``.git/index.lock`` is waited for (`LOCK_WAIT_SECONDS`) and never deleted.
- History is never rewritten: no ``reset``, no ``--force``, no ``rebase``. A restore is a new
  commit; a pull is a fast-forward or nothing.
- The managed ``.gitignore`` block is added to (or kept in) the file; the user's own lines are
  never touched.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

__all__ = [
    "Change",
    "DEFAULT_TIMEOUT",
    "FALLBACK_EMAIL",
    "FALLBACK_NAME",
    "GIT_ENV",
    "GitFailed",
    "GitMissing",
    "LOCK_WAIT_SECONDS",
    "MANAGED_END",
    "MANAGED_START",
    "NETWORK_TIMEOUT",
    "ahead_behind",
    "available",
    "branch_ok",
    "busy_operation",
    "commit_paths",
    "current_branch",
    "ensure_gitignore",
    "fast_forward",
    "fetch",
    "file_at",
    "file_log",
    "head",
    "ignores",
    "init",
    "log",
    "push",
    "remote_url",
    "remotes",
    "repo_top",
    "restore_tree",
    "run",
    "set_remote_url",
    "show",
    "status",
    "url_ok",
]

GIT_ENV = "OBJECT_GIT"
"""The git program to run (tests point it at a missing file); else ``git`` on the PATH."""
DEFAULT_TIMEOUT = 30.0
NETWORK_TIMEOUT = 120.0
LOCK_WAIT_SECONDS = 10.0
FALLBACK_NAME = "Object"
FALLBACK_EMAIL = "object@localhost"
MANAGED_START = "# Object: managed block (Object keeps these lines; add your own outside it)"
MANAGED_END = "# Object: end of managed block"
MAX_DIFF_BYTES = 64 * 1024
"""One file's diff is cut here (the preview says so)."""
MAX_SHOW_BYTES = 512 * 1024
"""A commit's whole diff is cut here."""

_LOCK_RE = re.compile(r"index\.lock|\.lock': File exists|Unable to create '.*\.lock'")


class GitMissing(RuntimeError):
    """There is no git program on this device."""


class GitFailed(RuntimeError):
    """A git call failed; ``message`` is a full sentence for the user, ``stderr`` git's words."""

    def __init__(self, message: str, stderr: str = "", code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.stderr = stderr
        self.code = code


@dataclass
class Change:
    """One ``git status --porcelain`` entry: index status ``x``, worktree status ``y``."""

    x: str
    y: str
    path: str
    orig: str | None = None

    @property
    def staged(self) -> bool:
        return self.x not in (" ", "?", "!")

    @property
    def untracked(self) -> bool:
        return self.x == "?"


@dataclass
class _Result:
    code: int
    out: bytes
    err: str
    extra: dict = field(default_factory=dict)


def git_program() -> str | None:
    override = os.environ.get(GIT_ENV)
    if override:
        return override if Path(override).is_file() and os.access(override, os.X_OK) else None
    return shutil.which("git")


def available() -> bool:
    return git_program() is not None


def _env(read_only: bool) -> dict[str, str]:
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_LITERAL_PATHSPECS"] = "1"
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=20")
    env["LC_ALL"] = "C"
    env.pop("GIT_DIR", None)
    env.pop("GIT_WORK_TREE", None)
    env.pop("GIT_INDEX_FILE", None)
    if read_only:
        env["GIT_OPTIONAL_LOCKS"] = "0"
    return env


def run(
    root: Path | str,
    args: list[str],
    *,
    input: bytes | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    read_only: bool = False,
    check: bool = True,
    config: list[str] | None = None,
) -> _Result:
    """Run ``git <config> <args>`` in `root`; wait out an ``index.lock`` (never delete it).

    Raises `GitMissing`, or `GitFailed` for a non-zero exit (with `check`) or a timeout.
    """
    program = git_program()
    if program is None:
        raise GitMissing("Git isn't installed on this device.")
    argv = [program, "-c", "core.quotePath=false", "-c", "protocol.ext.allow=never"]
    for item in config or []:
        argv += ["-c", item]
    argv += args
    deadline = time.monotonic() + LOCK_WAIT_SECONDS
    while True:
        try:
            proc = subprocess.run(  # noqa: S603 - list args, no shell, program from PATH
                argv,
                cwd=str(root),
                input=input if input is not None else b"",
                capture_output=True,
                timeout=timeout,
                env=_env(read_only),
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise GitFailed(f"Git didn't answer within {int(timeout)} seconds.", "timeout") from exc
        except OSError as exc:
            raise GitFailed(f"Git couldn't be started: {exc.strerror or exc}.") from exc
        err = proc.stderr.decode("utf-8", errors="replace")
        if proc.returncode != 0 and _LOCK_RE.search(err) and time.monotonic() < deadline:
            time.sleep(0.25)  # another git program holds the lock: wait, never delete it
            continue
        if proc.returncode != 0 and check:
            if _LOCK_RE.search(err):
                raise GitFailed(
                    "Another git program is using this repository (.git/index.lock). Object will try again.",
                    err,
                    proc.returncode,
                )
            raise GitFailed(_first_line(err) or f"Git stopped with code {proc.returncode}.", err, proc.returncode)
        return _Result(proc.returncode, proc.stdout, err)


def _first_line(err: str) -> str:
    for line in err.splitlines():
        line = line.strip()
        if line and not line.startswith("hint:"):
            text = line[0].upper() + line[1:]
            return text if text.endswith((".", "!", "?")) else text + "."
    return ""


def _text(out: bytes) -> str:
    return out.decode("utf-8", errors="replace")


# -- the repository ---------------------------------------------------------------------------


def repo_top(root: Path) -> Path | None:
    """The top folder of the repository `root` is in (itself or a parent), or None."""
    res = run(root, ["rev-parse", "--show-toplevel"], read_only=True, check=False)
    if res.code != 0:
        return None
    top = _text(res.out).strip()
    return Path(top).resolve() if top else None


def init(root: Path) -> None:
    """``git init`` in `root` (``main`` unless the user's ``init.defaultBranch`` says otherwise)."""
    configured = run(root, ["config", "--get", "init.defaultBranch"], read_only=True, check=False)
    branch = _text(configured.out).strip() or "main"
    run(root, ["init", "-q", "-b", branch])


def head(root: Path) -> str | None:
    res = run(root, ["rev-parse", "--verify", "-q", "HEAD"], read_only=True, check=False)
    sha = _text(res.out).strip()
    return sha if res.code == 0 and sha else None


def current_branch(root: Path) -> str | None:
    """The checked-out branch's name; None on a detached HEAD."""
    res = run(root, ["symbolic-ref", "-q", "--short", "HEAD"], read_only=True, check=False)
    name = _text(res.out).strip()
    return name if res.code == 0 and name else None


def busy_operation(root: Path) -> str | None:
    """A merge, rebase, cherry-pick or revert in progress (git's own state), else None."""
    res = run(root, ["rev-parse", "--git-dir"], read_only=True, check=False)
    git_dir = Path(_text(res.out).strip() or ".git")
    if not git_dir.is_absolute():
        git_dir = Path(root) / git_dir
    for name, what in (
        ("MERGE_HEAD", "merge"),
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    ):
        if (git_dir / name).exists():
            return what
    return None


def git_dir(root: Path) -> Path:
    res = run(root, ["rev-parse", "--git-dir"], read_only=True)
    path = Path(_text(res.out).strip())
    return path if path.is_absolute() else Path(root) / path


def ensure_gitignore(root: Path, lines: list[str]) -> bool:
    """Keep Object's block (`lines`) in ``root/.gitignore``; return whether the file was written.

    The user's lines outside the block are never changed; the file's line ends (CRLF or LF) are
    kept. Written atomically.
    """
    from .textfile import atomic_write

    path = Path(root) / ".gitignore"
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        raw = b""
    text = raw.decode("utf-8", errors="surrogateescape")
    nl = "\r\n" if "\r\n" in text else "\n"
    block = nl.join([MANAGED_START, *lines, MANAGED_END])
    start, end = text.find(MANAGED_START), text.find(MANAGED_END)
    if start != -1 and end > start:
        new = text[:start] + block + text[end + len(MANAGED_END):]
    else:
        sep = "" if not text or text.endswith(("\n", "\r")) else nl
        new = text + sep + (nl if text.strip() else "") + block + nl
    if new == text:
        return False
    atomic_write(path, new.encode("utf-8", errors="surrogateescape"))
    return True


def ignores(root: Path, rel: str) -> bool:
    """Whether git ignores `rel` (``git check-ignore``)."""
    res = run(root, ["check-ignore", "-q", "--no-index", "--", rel], read_only=True, check=False)
    return res.code == 0


# -- status and committing --------------------------------------------------------------------


def status(root: Path) -> list[Change]:
    """Every changed, staged or untracked path (``--untracked-files=all``; ignored ones left out)."""
    res = run(
        root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"],
        read_only=True,
    )
    out: list[Change] = []
    parts = res.out.split(b"\0")
    i = 0
    while i < len(parts):
        item = parts[i]
        i += 1
        if len(item) < 4:
            continue
        x, y = chr(item[0]), chr(item[1])
        path = item[3:].decode("utf-8", errors="surrogateescape")
        orig = None
        if x in ("R", "C"):
            orig = parts[i].decode("utf-8", errors="surrogateescape") if i < len(parts) else None
            i += 1
        out.append(Change(x, y, path, orig))
    return out


def _identity_config(root: Path) -> list[str]:
    """``user.name``/``user.email`` from the user's git config, else Object's own."""
    cfg: list[str] = []
    for key, fallback in (("user.name", FALLBACK_NAME), ("user.email", FALLBACK_EMAIL)):
        res = run(root, ["config", "--get", key], read_only=True, check=False)
        if not _text(res.out).strip():
            cfg.append(f"{key}={fallback}")
    return cfg


def _nul(paths: list[str]) -> bytes:
    return b"\0".join(p.encode("utf-8", errors="surrogateescape") for p in paths)


def commit_paths(root: Path, paths: list[str], message: str, add: list[str] | None = None) -> str:
    """Stage exactly `paths` (with their deletions) and commit only them; return the new HEAD.

    `add` limits the ``git add`` to the paths whose working copy differs from the index (a path
    already staged as deleted can't be added again); None adds them all.

    ``git commit --only`` leaves any entry another tool staged as it is. Hooks are skipped and
    commits aren't signed: a background commit must never wait on a hook or a pinentry.
    """
    if not paths:
        raise ValueError("no paths")
    identity = _identity_config(root)
    data = _nul(paths)
    to_add = paths if add is None else add
    if to_add:
        run(root, ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], input=_nul(to_add))
    spec = _pathspec_file(root, data)
    try:
        run(
            root,
            ["commit", "-q", "--no-verify", "-F", "-", "--only", f"--pathspec-from-file={spec}", "--pathspec-file-nul"],
            input=message.encode("utf-8"),
            config=[*identity, "commit.gpgsign=false"],
        )
    finally:
        Path(spec).unlink(missing_ok=True)
    sha = head(root)
    if sha is None:
        raise GitFailed("The commit wasn't made.")
    return sha


def _pathspec_file(root: Path, data: bytes) -> str:
    """Write the path list beside the index (`commit -F -` takes stdin for the message)."""
    path = git_dir(root) / "object-pathspec"
    path.write_bytes(data)
    return str(path)


def restore_tree(root: Path, sha: str) -> None:
    """Make the index and the tracked files match commit `sha` (paths added since are removed).

    Untracked and ignored files are left alone. Never moves HEAD: the caller commits the result.
    """
    run(root, ["restore", f"--source={sha}", "--staged", "--worktree", "--", "."])


# -- reading history --------------------------------------------------------------------------

_SEP_COMMIT = "\x1e"
_SEP_FIELD = "\x1f"
_FORMAT = f"--format={_SEP_COMMIT}%H{_SEP_FIELD}%h{_SEP_FIELD}%an{_SEP_FIELD}%aI{_SEP_FIELD}%s"


def _unquote(path: str) -> str:
    """A path git C-quoted (only when it holds a tab, newline, quote or backslash here)."""
    if not (path.startswith('"') and path.endswith('"')):
        return path
    body = path[1:-1]
    out = bytearray()
    i = 0
    simple = {"n": b"\n", "t": b"\t", '"': b'"', "\\": b"\\", "a": b"\a", "b": b"\b", "f": b"\f", "r": b"\r", "v": b"\v"}
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in simple:
                out += simple[nxt]
                i += 2
                continue
            if re.match(r"[0-7]{3}", body[i + 1 : i + 4]):
                out.append(int(body[i + 1 : i + 4], 8))
                i += 4
                continue
        out += ch.encode("utf-8")
        i += 1
    return out.decode("utf-8", errors="replace")


def _parse_log(text: str) -> list[dict]:
    commits: list[dict] = []
    for chunk in text.split(_SEP_COMMIT):
        if not chunk.strip():
            continue
        header, _, rest = chunk.partition("\n")
        fields = header.split(_SEP_FIELD)
        if len(fields) < 5:
            continue
        files = []
        for line in rest.splitlines():
            if not line.strip():
                continue
            cols = line.split("\t")
            code = cols[0]
            if code[:1] in ("R", "C") and len(cols) >= 3:
                files.append({"status": code[0], "oldPath": _unquote(cols[1]), "path": _unquote(cols[2])})
            elif len(cols) >= 2:
                files.append({"status": code[:1], "path": _unquote(cols[1])})
        commits.append(
            {
                "sha": fields[0],
                "short": fields[1],
                "author": fields[2],
                "at": fields[3],
                "message": _SEP_FIELD.join(fields[4:]),
                "files": files,
            }
        )
    return commits


def log(root: Path, limit: int = 50, skip: int = 0) -> list[dict]:
    """The current branch's commits, newest first, each with its changed files."""
    if head(root) is None:
        return []
    res = run(
        root,
        ["log", _FORMAT, "--name-status", "-M", f"--max-count={int(limit)}", f"--skip={int(skip)}", "HEAD"],
        read_only=True,
    )
    return _parse_log(_text(res.out))


def file_log(root: Path, rel: str, limit: int = 100) -> list[dict]:
    """The commits that changed `rel` (following renames), newest first, each with the path the
    file had in that commit (``path``)."""
    if head(root) is None:
        return []
    res = run(
        root,
        ["log", _FORMAT, "--name-status", "--follow", f"--max-count={int(limit)}", "HEAD", "--", rel],
        read_only=True,
    )
    out = []
    for c in _parse_log(_text(res.out)):
        files = c.pop("files")
        path = files[0]["path"] if files else rel
        status_ = files[0]["status"] if files else "M"
        out.append({**c, "path": path, "status": status_})
    return out


def file_at(root: Path, sha: str, rel: str) -> bytes | None:
    """`rel`'s bytes in commit `sha`; None when the commit has no such file."""
    res = run(root, ["cat-file", "blob", f"{sha}:{rel}"], read_only=True, check=False)
    return res.out if res.code == 0 else None


def _commit_ok(root: Path, sha: str) -> bool:
    if not re.fullmatch(r"[0-9a-fA-F]{4,64}", sha or ""):
        return False
    res = run(root, ["cat-file", "-e", f"{sha}^{{commit}}"], read_only=True, check=False)
    return res.code == 0


def resolve_commit(root: Path, sha: str) -> str | None:
    """The full id of commit `sha` (a hex prefix), or None when there is no such commit."""
    if not _commit_ok(root, sha):
        return None
    res = run(root, ["rev-parse", "--verify", "-q", f"{sha}^{{commit}}"], read_only=True, check=False)
    full = _text(res.out).strip()
    return full or None


def show(root: Path, sha: str, rel: str | None = None) -> list[dict]:
    """The text diff of commit `sha` against its first parent (a root commit: everything added),
    split per file: ``{path, oldPath?, status, binary, diff, truncated}``."""
    args = ["show", "--format=", "-M", "--no-color", "--no-ext-diff", "--patch", sha]
    if rel:
        args += ["--", rel]
    res = run(root, args, read_only=True)
    raw = res.out[:MAX_SHOW_BYTES]
    cut_all = len(res.out) > MAX_SHOW_BYTES
    text = _text(raw)
    files: list[dict] = []
    current: dict | None = None
    lines: list[str] = []

    def flush() -> None:
        if current is None:
            return
        body = "\n".join(lines)
        encoded = body.encode("utf-8")
        current["truncated"] = len(encoded) > MAX_DIFF_BYTES
        current["diff"] = encoded[:MAX_DIFF_BYTES].decode("utf-8", errors="ignore") if current["truncated"] else body
        files.append(current)

    for line in text.split("\n"):
        if line.startswith("diff --git "):
            flush()
            current = {"path": "", "status": "M", "binary": False}
            lines = []
            continue
        if current is None:
            continue
        if line.startswith("new file mode"):
            current["status"] = "A"
        elif line.startswith("deleted file mode"):
            current["status"] = "D"
        elif line.startswith("rename from "):
            current["oldPath"] = _unquote(line[len("rename from "):])
            current["status"] = "R"
        elif line.startswith("rename to "):
            current["path"] = _unquote(line[len("rename to "):])
        elif line.startswith("--- ") and not lines:
            if line != "--- /dev/null" and not current["path"]:
                current["path"] = _unquote(line[4:])[2:] if line[4:].startswith(("a/", '"a/')) else line[4:]
            continue
        elif line.startswith("+++ ") and not lines:
            if line != "+++ /dev/null":
                p = _unquote(line[4:])
                current["path"] = p[2:] if p.startswith("b/") else p
            continue
        elif line.startswith("Binary files "):
            current["binary"] = True
            m = re.match(r"Binary files (?:a/(.*)|/dev/null) and (?:b/(.*)|/dev/null) differ", line)
            if m and not current["path"]:
                current["path"] = m.group(2) or m.group(1) or ""
        elif line.startswith(("index ", "old mode", "new mode", "similarity index", "dissimilarity index")):
            continue
        else:
            lines.append(line)
    flush()
    if cut_all and files:
        files[-1]["truncated"] = True
    return files


# -- remotes ----------------------------------------------------------------------------------


def url_ok(url: str) -> bool:
    """A remote address git may be given: one line, no leading dash (no option injection), and
    not git's command-running ``ext::`` transport."""
    url = url.strip()
    if not url or len(url) > 2000 or url.startswith("-") or any(c in url for c in "\r\n\0 "):
        return False
    return not url.lower().startswith("ext::")


def branch_ok(root: Path, name: str) -> bool:
    if not name or name.startswith("-"):
        return False
    res = run(root, ["check-ref-format", "--branch", name], read_only=True, check=False)
    return res.code == 0


def remotes(root: Path) -> dict[str, str]:
    """``{name: fetch url}`` of the repository's remotes."""
    res = run(root, ["remote"], read_only=True, check=False)
    out = {}
    for name in _text(res.out).split():
        url = remote_url(root, name)
        if url is not None:
            out[name] = url
    return out


def remote_url(root: Path, name: str) -> str | None:
    res = run(root, ["config", "--get", f"remote.{name}.url"], read_only=True, check=False)
    url = _text(res.out).strip()
    return url if res.code == 0 and url else None


def set_remote_url(root: Path, name: str, url: str) -> None:
    if remote_url(root, name) is None:
        run(root, ["remote", "add", "--", name, url])
    else:
        run(root, ["remote", "set-url", "--", name, url])


def _tracking(remote: str, branch: str) -> str:
    return f"refs/remotes/{remote}/{branch}"


def ahead_behind(root: Path, remote: str, branch: str) -> tuple[int, int] | None:
    """(commits HEAD has that the remote branch hasn't, and the reverse), from the last fetch or
    push; None when the remote branch has never been seen."""
    ref = _tracking(remote, branch)
    if run(root, ["rev-parse", "--verify", "-q", ref], read_only=True, check=False).code != 0:
        return None
    if head(root) is None:
        return (0, 0)
    res = run(root, ["rev-list", "--left-right", "--count", f"HEAD...{ref}"], read_only=True)
    left, _, right = _text(res.out).strip().partition("\t")
    return int(left or 0), int(right or 0)


def fetch(root: Path, remote: str, branch: str, timeout: float = NETWORK_TIMEOUT) -> None:
    run(
        root,
        ["fetch", "--no-tags", "--quiet", "--", remote, f"+refs/heads/{branch}:{_tracking(remote, branch)}"],
        timeout=timeout,
    )


def fast_forward(root: Path, remote: str, branch: str) -> None:
    """``git merge --ff-only`` onto the remote branch (refuses anything but a fast-forward)."""
    run(root, ["merge", "--ff-only", "--quiet", _tracking(remote, branch)], config=["merge.verifySignatures=false"])


def push(root: Path, remote: str, branch: str, timeout: float = NETWORK_TIMEOUT) -> None:
    """Push HEAD to the remote branch. Never forced: a remote that moved on refuses it."""
    run(root, ["push", "--quiet", "--no-verify", "--", remote, f"HEAD:refs/heads/{branch}"], timeout=timeout)
    # Record what the remote now has, as a fetch would (some git setups don't for a push).
    sha = head(root)
    if sha:
        run(root, ["update-ref", _tracking(remote, branch), sha], check=False)


def short_date(iso: str) -> str:
    """``2026-11-08 14:02`` from git's ISO date."""
    return iso[:16].replace("T", " ") if iso else ""


def posix(rel: str) -> str:
    return PurePosixPath(rel.replace("\\", "/")).as_posix()
