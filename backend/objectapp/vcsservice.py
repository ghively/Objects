"""Version control and backup for spaces, and for the agents and settings (2026-11-08).

One git repository per space folder, and optionally one for the per-user state folder (agents,
automations, device settings, the spaces registry). Nothing here happens on its own: a space is
put under version control only when the user turns it on (Settings > Version control, or "Back
up all spaces"); opening a space never starts it.

Settings live in ``<state dir>/vcs.json`` (no secrets; keyed by the space's stable id, so a
moved folder keeps them): which repositories are on, each one's remote name, branch and
"push automatically", and the two delays. A remote's address is git's own (``.git/config``);
Object never stores a token or password. Run state (the last push and fetch, the last error)
is in ``<state dir>/vcs-status.json``, which the agents-and-settings repository leaves out.

`VcsService` (one per app) owns the background worker. Every `tick` it looks at each repository
that is on: the open space, every other registered space that is on, and the agents-and-settings
folder. A repository with changes is committed once nothing changed for ``commitDelaySeconds``
(default 2 minutes): app writes reset the wait through `touch`, other programs' edits through
the status fingerprint. Commits are also made when the app stops (switching or closing a space,
quitting). A repository with a remote and "push automatically" is pushed ``pushDelaySeconds``
(default 10 minutes) after its first unpushed commit. When the open space has a remote it is
fetched at start-up and fast-forwarded only when the folder has no changes and the remote is
simply ahead; a remote that has diverged is reported and left alone.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from . import vcs
from .appstate import state_dir
from .jsonstore import dump_json
from .spaceconfig import ensure_space_id, space_id
from .textfile import atomic_write

__all__ = [
    "CONFIG_FILE",
    "DEFAULT_COMMIT_DELAY",
    "DEFAULT_PUSH_DELAY",
    "SPACE_IGNORE",
    "STATE_IGNORE",
    "STATUS_FILE",
    "RepoTarget",
    "VcsRefused",
    "VcsService",
    "commit_message",
    "is_secret_path",
]

_log = logging.getLogger(__name__)

CONFIG_FILE = "vcs.json"
STATUS_FILE = "vcs-status.json"
DEFAULT_COMMIT_DELAY = 120
DEFAULT_PUSH_DELAY = 600
MIN_COMMIT_DELAY, MAX_COMMIT_DELAY = 10, 3600
MIN_PUSH_DELAY, MAX_PUSH_DELAY = 60, 86400
TICK_SECONDS = 10.0
LOCK_TIMEOUT = 10.0
STAGED_MARK = "object-staged"
"""``.git/object-staged``: the paths Object is staging right now, so an interrupted commit's
entries are still recognised as Object's own on the next try."""

SPACE_IGNORE = [
    ".object-cache/",
    ".*.tmp",
    ".DS_Store",
    "Thumbs.db",
]
"""The space repository's managed ``.gitignore`` block. ``.object/`` (types, trash, space.json)
is content and is never ignored; ``.*.tmp`` are the app's atomic-write temp files."""

STATE_IGNORE = [
    "secrets.json",
    "secrets.*",
    "*secret*",
    "*token*",
    "*credential*",
    "*.pem",
    "*.key",
    ".env",
    ".env.*",
    ".mcp.json",
    "settings.local.json",
    "*.unreadable-*",
    "history/",
    "fake-trash/",
    "*cache*/",
    ".object-cache/",
    "logs/",
    "*.log",
    "*.jsonl",
    "automation-logs-*/",
    "automations-*.json",
    "reminders-*.json",
    "work-queue-*.json",
    "work-alerts-*.json",
    "agents/.trash/",
    "**/.object-agent/sessions/",
    "**/.object-agent/usage.json",
    STATUS_FILE,
    ".*.tmp",
]
"""The agents-and-settings repository's managed block: secrets and token files, caches, the
version-history snapshots, logs and the run ledgers never go in. `is_secret_path` keeps the
secret ones out even when this block is edited away."""

_SECRET_RE = re.compile(
    r"(secret|token|credential|password|passwd|\.pem$|\.key$|^\.env(\..*)?$|^id_(rsa|dsa|ecdsa|ed25519)|^\.mcp\.json$|"
    r"^settings\.local\.json$|^\.netrc$|^\.git-credentials$)",
    re.IGNORECASE,
)

TARGET_SPACE = "space"
TARGET_STATE = "state"


class VcsRefused(Exception):
    """An action that can't be done; ``message`` is a full sentence for the user (409/422)."""

    def __init__(self, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def is_secret_path(rel: str) -> bool:
    """Whether the agents-and-settings repository must never commit `rel` (any secret-looking
    name, wherever it is; the snapshots under ``history/``)."""
    parts = PurePosixPath(rel).parts
    if not parts:
        return False
    if parts[0] == "history" or parts[0] == STATUS_FILE:
        return True
    return any(_SECRET_RE.search(part) for part in parts)


def _space_excluded(rel: str) -> bool:
    parts = PurePosixPath(rel).parts
    return bool(parts) and parts[0] == ".object-cache"


def _now_iso(now: datetime) -> str:
    return now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _is_object(rel: str) -> bool:
    p = PurePosixPath(rel)
    return p.suffix.lower() == ".md" and not any(part.startswith(".") for part in p.parts[:-1])


def commit_message(changes: list[vcs.Change], kind: str = TARGET_SPACE) -> str:
    """A short summary of what changed: ``Object: edit 3 objects (Printer jams, Rack, Tape)``,
    then the changed paths in the body."""
    def verb(items: list[vcs.Change]) -> str:
        if all(c.untracked or c.x == "A" for c in items):
            return "add"
        if all("D" in (c.x, c.y) for c in items):
            return "delete"
        return "edit"

    objects = [c for c in changes if _is_object(c.path)]
    others = [c for c in changes if not _is_object(c.path)]
    if kind == TARGET_STATE:
        n = len(changes)
        subject = f"Object: back up agents and settings ({n} file{'s' if n != 1 else ''})"
    elif objects:
        titles = [PurePosixPath(c.path).stem for c in objects]
        shown = ", ".join(titles[:3]) + (", …" if len(titles) > 3 else "")
        n = len(objects)
        subject = f"Object: {verb(objects)} {n} object{'s' if n != 1 else ''} ({shown})"
        if others:
            m = len(others)
            subject += f" and {m} other file{'s' if m != 1 else ''}"
    else:
        names = [PurePosixPath(c.path).name for c in others]
        shown = ", ".join(names[:3]) + (", …" if len(names) > 3 else "")
        n = len(others)
        subject = f"Object: update {n} file{'s' if n != 1 else ''} ({shown})"
    body = []
    for c in changes[:100]:
        code = "A" if c.untracked else ("D" if "D" in (c.x, c.y) else "M")
        body.append(f"{code} {c.path}")
    if len(changes) > 100:
        body.append(f"… and {len(changes) - 100} more")
    return subject + "\n\n" + "\n".join(body) + "\n"


@dataclass
class RepoTarget:
    """One repository Object looks after, with its run state."""

    key: str
    kind: str
    root: Path
    name: str
    lock: Any = None
    """The space's write lock (the open space only): held while staging and committing."""
    busy: threading.RLock = field(default_factory=threading.RLock)
    fingerprint: str | None = None
    last_change: float | None = None
    unpushed_since: float | None = None
    last_push_try: float | None = None
    warning: str | None = None
    error: dict | None = None
    remote_state: dict = field(default_factory=dict)

    def excluded(self, rel: str) -> bool:
        return is_secret_path(rel) if self.kind == TARGET_STATE else _space_excluded(rel)


class VcsService:
    """Version control for the open space, the other spaces that are on, and the agents and
    settings (see the module docstring). Thread-safe; the routes and the worker share it."""

    def __init__(
        self,
        space: Any = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        tick_seconds: float = TICK_SECONDS,
        on_restored: Callable[[RepoTarget, list[str]], None] | None = None,
        registered_spaces: Callable[[], list[Path]] | None = None,
    ) -> None:
        self.space = space
        self.clock = clock
        self.now = now
        self.tick_seconds = tick_seconds
        self.on_restored = on_restored
        self.registered_spaces = registered_spaces or (lambda: [])
        self._targets: dict[str, RepoTarget] = {}
        self._targets_lock = threading.Lock()
        self._config_lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._started_sync: threading.Thread | None = None

    # -- settings files -----------------------------------------------------------------------

    @property
    def config_path(self) -> Path:
        return state_dir() / CONFIG_FILE

    @property
    def status_path(self) -> Path:
        return state_dir() / STATUS_FILE

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        try:
            data = json.loads(path.read_bytes().decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def config(self) -> dict[str, Any]:
        data = self._read_json(self.config_path)
        spaces = data.get("spaces") if isinstance(data.get("spaces"), dict) else {}
        state = data.get("state") if isinstance(data.get("state"), dict) else {}
        return {
            "spaces": {k: v for k, v in spaces.items() if isinstance(v, dict)},
            "state": state,
            "commitDelaySeconds": _int_in(data.get("commitDelaySeconds"), MIN_COMMIT_DELAY, MAX_COMMIT_DELAY, DEFAULT_COMMIT_DELAY),
            "pushDelaySeconds": _int_in(data.get("pushDelaySeconds"), MIN_PUSH_DELAY, MAX_PUSH_DELAY, DEFAULT_PUSH_DELAY),
        }

    def _update_config(self, change: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        with self._config_lock:
            data = self.config()
            change(data)
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(self.config_path, dump_json(data))
            return data

    def _run_state(self, key: str) -> dict[str, Any]:
        entry = self._read_json(self.status_path).get(key)
        return entry if isinstance(entry, dict) else {}

    def _set_run_state(self, key: str, **values: Any) -> None:
        with self._config_lock:
            data = self._read_json(self.status_path)
            entry = data.get(key) if isinstance(data.get(key), dict) else {}
            entry.update(values)
            data[key] = entry
            self.status_path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(self.status_path, dump_json(data))

    def _entry(self, target: RepoTarget) -> dict[str, Any]:
        cfg = self.config()
        if target.kind == TARGET_STATE:
            return cfg["state"]
        return cfg["spaces"].get(target.key.split(":", 1)[1], {})

    def _set_entry(self, target: RepoTarget, **values: Any) -> None:
        def change(data: dict[str, Any]) -> None:
            if target.kind == TARGET_STATE:
                data["state"] = {**data["state"], **values}
            else:
                sid = target.key.split(":", 1)[1]
                data["spaces"][sid] = {**data["spaces"].get(sid, {}), **values, "path": str(target.root)}

        self._update_config(change)

    # -- targets ------------------------------------------------------------------------------

    def _target(self, key: str, kind: str, root: Path, name: str, lock: Any = None) -> RepoTarget:
        with self._targets_lock:
            t = self._targets.get(key)
            if t is None or t.root != root:
                t = RepoTarget(key=key, kind=kind, root=root, name=name, lock=lock)
                self._targets[key] = t
            elif lock is not None:
                t.lock = lock
            return t

    def space_target(self, root: Path | None = None, create_id: bool = False) -> RepoTarget | None:
        """The repository target of the space at `root` (the open space by default); None when
        the space has no id yet (it has never been put under version control)."""
        is_open = root is None or (self.space is not None and Path(root).resolve() == self.space.root)
        root = self.space.root if root is None else Path(root).resolve()
        sid = ensure_space_id(root) if create_id else space_id(root)
        if sid is None:
            return None
        from .spaceconfig import space_fields

        lock = self.space._lock if is_open and self.space is not None else None
        return self._target(f"space:{sid}", TARGET_SPACE, root, space_fields(root)["name"], lock)

    def state_target(self) -> RepoTarget:
        return self._target("state", TARGET_STATE, state_dir().resolve(), "Agents and settings")

    def target(self, which: str) -> RepoTarget | None:
        return self.state_target() if which == TARGET_STATE else self.space_target()

    def enabled(self, target: RepoTarget | None) -> bool:
        return target is not None and self._entry(target).get("enabled") is True

    def active_targets(self) -> list[RepoTarget]:
        """Every repository that is on: the open space, other registered spaces, the state folder."""
        out: list[RepoTarget] = []
        cfg = self.config()
        if self.space is not None:
            t = self.space_target()
            if t is not None and self.enabled(t):
                # The folder may have moved: keep the settings' path current.
                if cfg["spaces"].get(t.key.split(":", 1)[1], {}).get("path") != str(t.root):
                    with contextlib.suppress(OSError):
                        self._set_entry(t)
                out.append(t)
        seen = {t.root for t in out}
        for root in self.registered_spaces():
            try:
                root = Path(root).resolve()
            except OSError:
                continue
            if root in seen or not root.is_dir():
                continue
            seen.add(root)
            sid = space_id(root)
            entry = cfg["spaces"].get(sid or "", {})
            if sid and entry.get("enabled") is True and (root / ".git").exists():
                t = self.space_target(root)
                if t is not None:
                    out.append(t)
        if cfg["state"].get("enabled") is True:
            out.append(self.state_target())
        return out

    # -- enabling -----------------------------------------------------------------------------

    def enable_space(self, root: Path | None = None) -> RepoTarget:
        """Put a space under version control: adopt its repository or ``git init`` one, keep the
        managed ``.gitignore`` block, give the space its id and make the first commit."""
        self._need_git()
        folder = (self.space.root if root is None else Path(root)).resolve()
        if not folder.is_dir():
            raise VcsRefused(f'"{folder}" is not a folder.', 404)
        self._check_own_repository(folder)
        target = self.space_target(folder, create_id=True)
        assert target is not None
        with target.busy:
            if vcs.repo_top(folder) != folder:
                vcs.init(folder)
            from .history import HistoryStore

            with contextlib.suppress(Exception):
                HistoryStore(folder).migrate()
            vcs.ensure_gitignore(folder, SPACE_IGNORE)
            self._set_entry(target, enabled=True)
            first = vcs.head(folder) is None
            self._commit(target, "Object: start version control\n" if first else None)
        return target

    def enable_state(self) -> RepoTarget:
        """Put the agents-and-settings folder under version control (secrets never go in)."""
        self._need_git()
        folder = state_dir()
        folder.mkdir(parents=True, exist_ok=True)
        target = self.state_target()
        with target.busy:
            if vcs.repo_top(target.root) != target.root:
                vcs.init(target.root)
            vcs.ensure_gitignore(target.root, STATE_IGNORE)
            self._set_entry(target, enabled=True)
            first = vcs.head(target.root) is None
            self._commit(target, "Object: start backing up agents and settings\n" if first else None)
        return target

    def disable(self, target: RepoTarget) -> None:
        """Stop committing and pushing. The repository and its history are left as they are."""
        self._set_entry(target, enabled=False)

    def enable_all(self) -> list[dict[str, Any]]:
        """`enable_space` for every registered space folder (and the open one)."""
        roots: list[Path] = []
        if self.space is not None:
            roots.append(self.space.root)
        for r in self.registered_spaces():
            with contextlib.suppress(OSError):
                p = Path(r).resolve()
                if p not in roots:
                    roots.append(p)
        out = []
        for root in roots:
            from .spaceconfig import space_fields

            item: dict[str, Any] = {"path": str(root), "name": root.name, "ok": False, "message": None}
            try:
                if not root.is_dir():
                    raise VcsRefused(f'"{root}" is not a folder.', 404)
                item["name"] = space_fields(root)["name"]
                self.enable_space(root)
                item["ok"] = True
            except VcsRefused as exc:
                item["message"] = exc.message
            except vcs.GitFailed as exc:
                item["message"] = exc.message
            except Exception as exc:  # noqa: BLE001 - one space's failure doesn't stop the rest
                _log.exception("Enabling version control failed for %s", root)
                item["message"] = f"Version control couldn't be turned on: {exc}."
            out.append(item)
        return out

    def _need_git(self) -> None:
        if not vcs.available():
            raise VcsRefused("Git isn't installed on this device, so version control stays off.", 422)

    def _check_own_repository(self, folder: Path) -> None:
        """Refuse a folder whose files another repository (in a parent folder) already tracks:
        a second repository there would hide them from that one."""
        top = vcs.repo_top(folder)
        if top is None or top == folder:
            return
        res = vcs.run(top, ["ls-files", "-z", "--", str(folder.relative_to(top))], read_only=True, check=False)
        if res.out.strip(b"\0"):
            raise VcsRefused(
                f'This space\'s folder is part of the git repository in "{top}". '
                "Object only turns on version control for a folder that isn't tracked by another repository.",
                422,
            )

    # -- committing ---------------------------------------------------------------------------

    @contextlib.contextmanager
    def _write_lock(self, target: RepoTarget):
        lock = target.lock
        if lock is None:
            yield
            return
        if not lock.acquire(True, LOCK_TIMEOUT):
            raise VcsRefused("The space is busy saving. Object will try again.")
        try:
            yield
        finally:
            lock.release()

    def _changes(self, target: RepoTarget) -> tuple[list[vcs.Change], list[vcs.Change]]:
        """(Object's changes to commit, entries another program staged)."""
        marked = self._marked(target)
        ours: list[vcs.Change] = []
        foreign: list[vcs.Change] = []
        for c in vcs.status(target.root):
            if target.excluded(c.path) or (c.orig and target.excluded(c.orig)):
                continue
            if c.staged and c.path not in marked:
                foreign.append(c)
            else:
                ours.append(c)
        foreign_paths = {c.path for c in foreign}
        return [c for c in ours if c.path not in foreign_paths], foreign

    def _marked(self, target: RepoTarget) -> set[str]:
        try:
            data = (vcs.git_dir(target.root) / STAGED_MARK).read_bytes()
        except (OSError, vcs.GitFailed):
            return set()
        return {p.decode("utf-8", errors="surrogateescape") for p in data.split(b"\0") if p}

    def _commit(self, target: RepoTarget, message: str | None = None) -> str | None:
        """Commit Object's pending changes now; the new commit's id, or None when there were none.

        Holds the space's write lock, so no app write is half done. Entries another program
        staged are left staged and reported (``warning``).
        """
        with target.busy, self._write_lock(target):
            op = vcs.busy_operation(target.root)
            if op is not None:
                target.warning = f"A git {op} is in progress in this folder, so Object isn't committing."
                return None
            if vcs.current_branch(target.root) is None:
                target.warning = "The repository isn't on a branch (a detached HEAD), so Object isn't committing."
                return None
            ours, foreign = self._changes(target)
            target.warning = (
                f"{len(foreign)} change{'s are' if len(foreign) != 1 else ' is'} staged by another program; "
                "Object leaves them for you to commit."
                if foreign
                else None
            )
            if not ours:
                return None
            paths, add = _paths_of(ours)
            mark = vcs.git_dir(target.root) / STAGED_MARK
            mark.write_bytes(b"\0".join(p.encode("utf-8", errors="surrogateescape") for p in paths))
            try:
                sha = vcs.commit_paths(target.root, paths, message or commit_message(ours, target.kind), add=add)
            finally:
                mark.unlink(missing_ok=True)
            target.fingerprint = None
            target.error = None
            if target.unpushed_since is None and self._remote(target) is not None:
                target.unpushed_since = self.clock()
            return sha

    def commit_now(self, target: RepoTarget) -> str | None:
        self._need_git()
        if not self.enabled(target):
            raise VcsRefused("Version control is off for this space.")
        try:
            return self._commit(target)
        except vcs.GitFailed as exc:
            self._fail(target, exc.message)
            raise VcsRefused(exc.message) from exc

    def touch(self) -> None:
        """An app write just happened in the open space: the commit waits from now."""
        if self.space is None:
            return
        sid = space_id(self.space.root)
        if sid is None:
            return
        t = self._targets.get(f"space:{sid}")
        if t is not None:
            t.last_change = self.clock()

    def _fingerprint(self, target: RepoTarget, changes: list[vcs.Change]) -> str:
        h = hashlib.sha1()
        for c in changes:
            h.update(f"{c.x}{c.y}{c.path}\0".encode("utf-8", errors="surrogateescape"))
            with contextlib.suppress(OSError):
                st = os.stat(target.root / c.path)
                h.update(f"{st.st_mtime_ns}:{st.st_size}\0".encode())
        return h.hexdigest()

    def _fail(self, target: RepoTarget, message: str) -> None:
        target.error = {"at": _now_iso(self.now()), "message": message}

    def check(self, target: RepoTarget) -> None:
        """One look at `target`: commit once it has been quiet for the commit delay, push once
        the push delay has passed since its first unpushed commit."""
        if not target.busy.acquire(blocking=False):
            return
        try:
            cfg = self.config()
            now = self.clock()
            try:
                ours, _foreign = self._changes(target)
            except vcs.GitFailed as exc:
                self._fail(target, exc.message)
                return
            fp = self._fingerprint(target, ours)
            if fp != target.fingerprint:
                target.fingerprint = fp
                target.last_change = now
            if ours and target.last_change is not None and now - target.last_change >= cfg["commitDelaySeconds"]:
                try:
                    self._commit(target)
                except vcs.GitFailed as exc:
                    self._fail(target, exc.message)
                except VcsRefused as exc:
                    self._fail(target, exc.message)
            remote = self._remote(target)
            entry = self._entry(target)
            if (
                remote is not None
                and entry.get("autoPush", True) is not False
                and target.unpushed_since is not None
                and now - target.unpushed_since >= cfg["pushDelaySeconds"]
                and (target.last_push_try is None or now - target.last_push_try >= cfg["pushDelaySeconds"])
            ):
                with contextlib.suppress(VcsRefused):
                    self.push_now(target, commit_first=False)
        finally:
            target.busy.release()

    def tick(self) -> None:
        if not vcs.available():
            return
        for target in self.active_targets():
            try:
                self.check(target)
            except Exception:  # noqa: BLE001 - one repository's trouble never stops the others
                _log.exception("Version control check failed for %s", target.root)

    def time_to_commit(self, target: RepoTarget, pending: int) -> int | None:
        if not pending or target.last_change is None:
            return None
        left = self.config()["commitDelaySeconds"] - (self.clock() - target.last_change)
        return max(0, int(left))

    # -- remotes ------------------------------------------------------------------------------

    def _remote(self, target: RepoTarget) -> tuple[str, str] | None:
        """(remote name, branch) when this repository has a remote set in Object, else None."""
        entry = self._entry(target)
        name = entry.get("remote")
        if not isinstance(name, str) or not name:
            return None
        branch = entry.get("branch")
        if not isinstance(branch, str) or not branch:
            branch = vcs.current_branch(target.root) or "main"
        return name, branch

    def set_remote(self, target: RepoTarget, url: str, branch: str | None, auto_push: bool | None) -> None:
        """Set (or, with an empty `url`, stop using) the remote this repository backs up to.

        Object's settings keep the remote's name; its address goes to git's own config. Clearing
        it leaves git's remote as it is (an adopted repository's ``origin`` stays)."""
        self._need_git()
        url = (url or "").strip()
        if not url:
            self._set_entry(target, remote=None, branch=None)
            target.remote_state = {}
            target.unpushed_since = None
            return
        if not vcs.url_ok(url):
            raise VcsRefused("That isn't a git remote address (https://… or git@host:path).", 422)
        branch = (branch or "").strip() or None
        if branch is not None and not vcs.branch_ok(target.root, branch):
            raise VcsRefused(f'"{branch}" isn\'t a branch name git accepts.', 422)
        name = self._entry(target).get("remote") or "origin"
        with target.busy:
            vcs.set_remote_url(target.root, name, url)
        values: dict[str, Any] = {"remote": name, "branch": branch}
        if auto_push is not None:
            values["autoPush"] = bool(auto_push)
        self._set_entry(target, **values)
        target.remote_state = {}
        ab = vcs.ahead_behind(target.root, name, branch or vcs.current_branch(target.root) or "main")
        if ab is None or ab[0] > 0:
            target.unpushed_since = self.clock()

    def set_auto_push(self, target: RepoTarget, auto_push: bool) -> None:
        self._set_entry(target, autoPush=bool(auto_push))

    def fetch(self, target: RepoTarget, fast_forward: bool = True) -> dict[str, Any]:
        """Fetch the remote branch; fast-forward when the folder has no changes and the remote is
        only ahead. A diverged remote is reported (``diverged``) and nothing is merged."""
        self._need_git()
        remote = self._remote(target)
        if remote is None:
            raise VcsRefused("No remote is set for this space.")
        name, branch = remote
        with target.busy:
            try:
                vcs.fetch(target.root, name, branch)
            except vcs.GitFailed as exc:
                if "couldn't find remote ref" in exc.stderr.lower():
                    target.remote_state = {"fetchedAt": _now_iso(self.now()), "missing": True}
                    return target.remote_state
                self._fail(target, f"The remote couldn't be reached: {exc.message}")
                raise VcsRefused(target.error["message"]) from exc
            self._set_run_state(target.key, lastFetch=_now_iso(self.now()))
            ab = vcs.ahead_behind(target.root, name, branch) or (0, 0)
            state = {"fetchedAt": _now_iso(self.now()), "ahead": ab[0], "behind": ab[1], "diverged": ab[0] > 0 and ab[1] > 0}
            if fast_forward and ab[1] > 0 and ab[0] == 0:
                with self._write_lock(target):
                    ours, foreign = self._changes(target)
                    if ours or foreign:
                        state["blocked"] = "The space has changes that aren't committed yet, so Object didn't update it from the remote."
                    else:
                        before = vcs.head(target.root)
                        try:
                            vcs.fast_forward(target.root, name, branch)
                        except vcs.GitFailed as exc:
                            self._fail(target, exc.message)
                            raise VcsRefused(exc.message) from exc
                        changed = self._changed_between(target, before, vcs.head(target.root))
                        state.update(ahead=0, behind=0, pulled=ab[1])
                        if self.on_restored is not None:
                            self.on_restored(target, changed)
            target.remote_state = state
            target.error = None
            return state

    def push_now(self, target: RepoTarget, commit_first: bool = True) -> dict[str, Any]:
        """Commit what's pending, then push. Never forced: when the remote has commits this
        repository hasn't, nothing is pushed and the status says the remote has diverged."""
        self._need_git()
        remote = self._remote(target)
        if remote is None:
            raise VcsRefused("No remote is set for this space.")
        name, branch = remote
        with target.busy:
            target.last_push_try = self.clock()
            if commit_first:
                try:
                    self._commit(target)
                except vcs.GitFailed as exc:
                    self._fail(target, exc.message)
                    raise VcsRefused(exc.message) from exc
            if vcs.head(target.root) is None:
                raise VcsRefused("There is nothing to push yet.")
            try:
                vcs.fetch(target.root, name, branch)
            except vcs.GitFailed as exc:
                if "couldn't find remote ref" not in exc.stderr.lower():
                    self._fail(target, f"The remote couldn't be reached: {exc.message}")
                    raise VcsRefused(target.error["message"]) from exc
            ab = vcs.ahead_behind(target.root, name, branch)
            if ab is not None and ab[1] > 0:
                target.remote_state = {"ahead": ab[0], "behind": ab[1], "diverged": ab[0] > 0}
                message = (
                    f"The remote has diverged: it has {ab[1]} commit{'s' if ab[1] != 1 else ''} this space doesn't, "
                    f"and this space has {ab[0]} it doesn't. Object never overwrites the remote; merge them with git."
                    if ab[0] > 0
                    else f"The remote has {ab[1]} new commit{'s' if ab[1] != 1 else ''}. Update from the remote first."
                )
                self._fail(target, message)
                raise VcsRefused(message)
            if ab is not None and ab[0] == 0:
                target.unpushed_since = None
                target.remote_state = {"ahead": 0, "behind": 0, "diverged": False}
                return target.remote_state
            try:
                vcs.push(target.root, name, branch)
            except vcs.GitFailed as exc:
                self._fail(target, f"The push didn't go through: {exc.message}")
                raise VcsRefused(target.error["message"]) from exc
            self._set_run_state(target.key, lastPush=_now_iso(self.now()))
            target.unpushed_since = None
            target.error = None
            target.remote_state = {"ahead": 0, "behind": 0, "diverged": False}
            return target.remote_state

    # -- history and restoring ----------------------------------------------------------------

    def _changed_between(self, target: RepoTarget, a: str | None, b: str | None) -> list[str]:
        if not a or not b or a == b:
            return []
        res = vcs.run(target.root, ["diff", "--name-only", "-z", "--no-renames", a, b], read_only=True)
        return [p.decode("utf-8", errors="surrogateescape") for p in res.out.split(b"\0") if p]

    def restore_space(self, target: RepoTarget, sha: str) -> dict[str, Any]:
        """Make the space's files what they were at commit `sha`, as a NEW commit (history is never
        rewritten). Pending changes are committed first so nothing is lost."""
        self._need_git()
        full = vcs.resolve_commit(target.root, sha)
        if full is None:
            raise VcsRefused(f'There is no commit "{sha}" in this space\'s history.', 404)
        with target.busy, self._write_lock(target):
            self._commit(target)
            _ours, foreign = self._changes(target)
            if foreign:
                raise VcsRefused(
                    "Another program has staged changes in this repository. Commit or unstage them before restoring."
                )
            before = vcs.head(target.root)
            sid = space_id(target.root) if target.kind == TARGET_SPACE else None
            vcs.restore_tree(target.root, full)
            if sid is not None:
                with contextlib.suppress(Exception):
                    ensure_space_id(target.root, wanted=sid)
            vcs.ensure_gitignore(target.root, SPACE_IGNORE if target.kind == TARGET_SPACE else STATE_IGNORE)
            # `git restore --staged` staged the restored paths itself; nothing else was staged
            # (refused above), so every entry is the restore's own.
            ours, restored = self._changes(target)
            ours = ours + restored
            if not ours:
                return {"commit": None, "changed": []}
            info = vcs.run(target.root, ["log", "-1", "--format=%h%x1f%aI", full], read_only=True)
            short, _, at = vcs._text(info.out).strip().partition("\x1f")
            message = f"Object: restore to {short} ({vcs.short_date(at)})\n\n" + "\n".join(
                f"{'A' if c.untracked else 'M'} {c.path}" for c in ours[:100]
            ) + "\n"
            paths, add = _paths_of(ours)
            new = vcs.commit_paths(target.root, paths, message, add=add)
            target.fingerprint = None
            if target.unpushed_since is None and self._remote(target) is not None:
                target.unpushed_since = self.clock()
            changed = self._changed_between(target, before, new)
        if self.on_restored is not None:
            self.on_restored(target, changed)
        return {"commit": new, "changed": changed}

    def commit_file(self, target: RepoTarget, rel: str, message: str) -> str | None:
        """Commit one path (after a one-file restore)."""
        with target.busy, self._write_lock(target):
            ours, _foreign = self._changes(target)
            mine = [c for c in ours if c.path == rel]
            if not mine:
                return None
            return vcs.commit_paths(target.root, [rel], message)

    # -- status -------------------------------------------------------------------------------

    def status(self, target: RepoTarget | None, which: str = TARGET_SPACE) -> dict[str, Any]:
        """What the settings and the sidebar show for one repository."""
        base: dict[str, Any] = {"target": which, "gitAvailable": vcs.available()}
        if target is None:
            root = self.space.root if (which == TARGET_SPACE and self.space is not None) else state_dir()
            return {**base, "enabled": False, "repository": (Path(root) / ".git").exists(), "root": str(root)}
        entry = self._entry(target)
        out: dict[str, Any] = {
            **base,
            "root": str(target.root),
            "name": target.name,
            "enabled": entry.get("enabled") is True,
            "repository": (target.root / ".git").exists(),
        }
        if not base["gitAvailable"] or not out["repository"]:
            return out
        try:
            branch = vcs.current_branch(target.root)
            last = None
            if vcs.head(target.root) is not None:
                res = vcs.run(target.root, ["log", "-1", "--format=%H%x1f%h%x1f%aI%x1f%s"], read_only=True)
                parts = vcs._text(res.out).strip().split("\x1f")
                if len(parts) >= 4:
                    last = {"sha": parts[0], "short": parts[1], "at": parts[2], "message": "\x1f".join(parts[3:])}
            ours, foreign = self._changes(target)
            remote = self._remote(target)
            run_state = self._run_state(target.key)
            remote_info = None
            if remote is not None:
                name, rbranch = remote
                ab = vcs.ahead_behind(target.root, name, rbranch)
                remote_info = {
                    "name": name,
                    "url": vcs.remote_url(target.root, name),
                    "branch": rbranch,
                    "autoPush": entry.get("autoPush", True) is not False,
                    "ahead": ab[0] if ab else None,
                    "behind": ab[1] if ab else None,
                    "diverged": bool(ab and ab[0] > 0 and ab[1] > 0),
                    "neverPushed": ab is None,
                    "lastPush": run_state.get("lastPush"),
                    "lastFetch": run_state.get("lastFetch"),
                    "blocked": target.remote_state.get("blocked"),
                }
            out.update(
                branch=branch,
                lastCommit=last,
                pending=len(ours),
                nextCommitIn=self.time_to_commit(target, len(ours)) if out["enabled"] else None,
                foreignStaged=len(foreign),
                warning=target.warning,
                error=target.error,
                busyOperation=vcs.busy_operation(target.root),
                remote=remote_info,
                remotes=vcs.remotes(target.root),
                ignoresObjectFolder=target.kind == TARGET_SPACE and vcs.ignores(target.root, ".object/space.json"),
            )
        except vcs.GitFailed as exc:
            out["error"] = {"at": _now_iso(self.now()), "message": exc.message}
        return out

    def settings(self) -> dict[str, int]:
        cfg = self.config()
        return {"commitDelaySeconds": cfg["commitDelaySeconds"], "pushDelaySeconds": cfg["pushDelaySeconds"]}

    def set_settings(self, commit_delay: int | None, push_delay: int | None) -> dict[str, int]:
        def change(data: dict[str, Any]) -> None:
            if commit_delay is not None:
                if not MIN_COMMIT_DELAY <= commit_delay <= MAX_COMMIT_DELAY:
                    raise VcsRefused(f"The commit delay is between {MIN_COMMIT_DELAY} and {MAX_COMMIT_DELAY} seconds.", 422)
                data["commitDelaySeconds"] = commit_delay
            if push_delay is not None:
                if not MIN_PUSH_DELAY <= push_delay <= MAX_PUSH_DELAY:
                    raise VcsRefused(f"The push delay is between {MIN_PUSH_DELAY} and {MAX_PUSH_DELAY} seconds.", 422)
                data["pushDelaySeconds"] = push_delay

        self._update_config(change)
        return self.settings()

    # -- lifecycle ----------------------------------------------------------------------------

    def start(self) -> None:
        """Start the worker, and (off the request path) fetch the open space's remote."""
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="vcs-worker", daemon=True)
        self._thread.start()
        self._started_sync = threading.Thread(target=self._sync_on_open, name="vcs-open-sync", daemon=True)
        self._started_sync.start()

    def _sync_on_open(self) -> None:
        if not vcs.available() or self.space is None:
            return
        target = self.space_target()
        if target is None or not self.enabled(target):
            return
        try:
            vcs.ensure_gitignore(target.root, SPACE_IGNORE)
        except (OSError, vcs.GitFailed):
            pass
        if self._remote(target) is None:
            return
        with contextlib.suppress(VcsRefused, vcs.GitFailed, OSError):
            state = self.fetch(target)
            if state.get("ahead"):
                target.unpushed_since = self.clock()

    def _loop(self) -> None:
        while not self._stop.wait(self.tick_seconds):
            try:
                self.tick()
            except Exception:  # noqa: BLE001
                _log.exception("The version-control worker failed")

    def stop(self) -> None:
        """Stop the worker and commit what's pending everywhere (switching or closing a space,
        quitting). Nothing is pushed here: the next start pushes."""
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=30)
        if not vcs.available():
            return
        for target in self.active_targets():
            try:
                self._commit(target)
            except Exception:  # noqa: BLE001
                _log.exception("The closing commit failed for %s", target.root)


def _paths_of(changes: list[vcs.Change]) -> tuple[list[str], list[str]]:
    """(every path to commit, the ones to ``git add`` first: whose working copy differs)."""
    paths: list[str] = []
    add: list[str] = []
    for c in changes:
        paths.append(c.path)
        if c.orig:
            paths.append(c.orig)
        if c.untracked or c.y != " ":
            add.append(c.path)
    return paths, add


def _int_in(value: Any, lo: int, hi: int, default: int) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi else default
