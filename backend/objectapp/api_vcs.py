"""The version-control routes (2026-11-08; `vcsservice` has the rules, `vcs` the git calls).

``target`` is ``space`` (the open space, the default) or ``state`` (the agents and settings).

- ``GET /api/vcs/status?target=`` -> ``RepoStatus`` (``gitAvailable``, ``enabled``, ``lastCommit``,
  ``pending``, ``remote`` with ``ahead``/``behind``/``diverged``/``lastPush``, ``warning``, ``error``)
  plus ``settings`` (the two delays).
- ``POST /api/vcs/enable`` / ``POST /api/vcs/disable`` ``{target}`` -> ``RepoStatus``. Turning it off
  never deletes the repository or its history.
- ``POST /api/vcs/enable-all`` -> ``{spaces: [{path, name, ok, message}]}``: "Back up all spaces".
- ``POST /api/vcs/commit`` ``{target}`` -> ``{commit, status}``: commit what's pending now.
- ``PUT /api/vcs/remote`` ``{target, url, branch?, autoPush?}`` -> ``RepoStatus`` (an empty url stops
  using the remote). ``POST /api/vcs/push`` / ``POST /api/vcs/fetch`` ``{target}`` -> ``RepoStatus``.
- ``PUT /api/vcs/settings`` ``{commitDelaySeconds?, pushDelaySeconds?}`` -> the settings.
- ``GET /api/vcs/log?limit=&skip=`` -> ``{commits: [{sha, short, author, at, message, files}], more}``.
- ``GET /api/vcs/diff?sha=&path=`` -> ``{files: [{path, oldPath?, status, binary, diff, truncated}]}``.
- ``POST /api/vcs/restore`` ``{sha, clientId?}`` -> ``{commit, changed, status}``: a NEW commit that
  puts the space back as it was at ``sha``; the space's index reloads.
- ``GET /api/vcs/file-log?path=`` -> ``{versions: [{sha, short, author, at, message, path, status}]}``.
- ``GET /api/vcs/file?sha=&path=`` -> ``{text}`` (``path`` as it was in that commit).
- ``POST /api/vcs/file-restore`` ``{path, sha, sourcePath?, baseVersion, clientId?}`` ->
  ``{version, commit}``: one object back to its state in ``sha``, as a new commit.

Errors answer ``{detail}``: 404 (no such commit or object), 409 (refused: a merge in progress,
staged changes, a diverged remote), 422 (git missing, a bad address). Agent runs can't reach any
of this (``runfence``); none of it is an MCP tool.
"""

from __future__ import annotations

import contextlib
from pathlib import PurePosixPath
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import vcs
from .apictx import ApiContext
from .vcsservice import TARGET_SPACE, TARGET_STATE, RepoTarget, VcsRefused, VcsService
from .watcher import ChangeEvent

__all__ = ["reload_after_restore", "router"]


class TargetRequest(BaseModel):
    target: str = TARGET_SPACE


class RemoteRequest(BaseModel):
    target: str = TARGET_SPACE
    url: str = ""
    branch: str | None = None
    autoPush: bool | None = None


class SettingsRequest(BaseModel):
    commitDelaySeconds: int | None = None
    pushDelaySeconds: int | None = None


class RestoreRequest(BaseModel):
    sha: str
    clientId: str | None = None


class FileRestoreRequest(BaseModel):
    path: str
    sha: str
    sourcePath: str | None = None
    baseVersion: str
    clientId: str | None = None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


RESYNC_KINDS = ("types", "views", "ui", "collections", "queries")


def reload_after_restore(ctx: ApiContext, target: RepoTarget, changed: list[str]) -> None:
    """Bring the open space's index up to date with files git just rewrote, and tell the
    clients (the watcher would too; this makes the answer consistent without waiting for it)."""
    space = ctx.space
    if target.kind != TARGET_SPACE or target.root != space.root:
        return
    for rel in changed:
        p = PurePosixPath(rel)
        if p.suffix.lower() == ".md" and not any(part.startswith(".") for part in p.parts[:-1]):
            with contextlib.suppress(ValueError, OSError, KeyError):
                exists = (space.root / rel).is_file()
                space.rescan_file(rel)
                ctx.announce(ChangeEvent("changed" if exists else "deleted", rel, None))
        elif len(p.parts) == 3 and p.parts[0] == ".object" and p.parts[1] == "types" and p.suffix == ".json":
            with contextlib.suppress(Exception):
                space.refresh_type(p.stem)
    with contextlib.suppress(Exception):
        space.reload_collections()
    for kind in RESYNC_KINDS:
        ctx.announce(ChangeEvent(kind, "*", None))


def router(ctx: ApiContext, service: VcsService) -> APIRouter:
    space = ctx.space
    r = APIRouter(prefix="/vcs")

    def target_of(which: str, create: bool = False) -> RepoTarget | None:
        if which not in (TARGET_SPACE, TARGET_STATE):
            raise VcsRefused(f'"{which}" isn\'t a version-control target.', 422)
        if which == TARGET_STATE:
            return service.state_target()
        return service.space_target(create_id=create)

    def need(which: str) -> RepoTarget:
        t = target_of(which)
        if t is None or not service.enabled(t):
            raise VcsRefused(
                "Version control is off for this space." if which == TARGET_SPACE
                else "Backing up agents and settings is off."
            )
        return t

    def status(which: str) -> dict[str, Any]:
        return {**service.status(target_of(which), which), "settings": service.settings()}

    def refused(exc: VcsRefused | vcs.GitFailed | vcs.GitMissing) -> JSONResponse:
        if isinstance(exc, VcsRefused):
            return _error(exc.status, exc.message)
        if isinstance(exc, vcs.GitMissing):
            return _error(422, "Git isn't installed on this device, so version control stays off.")
        return _error(409, exc.message)

    @r.get("/status")
    def get_status(target: str = TARGET_SPACE):
        try:
            return status(target)
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.post("/enable")
    def post_enable(req: TargetRequest):
        try:
            if req.target == TARGET_STATE:
                service.enable_state()
            else:
                target_of(req.target)
                service.enable_space()
            return status(req.target)
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.post("/disable")
    def post_disable(req: TargetRequest):
        try:
            t = target_of(req.target)
            if t is not None:
                service.disable(t)
            return status(req.target)
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.post("/enable-all")
    def post_enable_all():
        if not vcs.available():
            return _error(422, "Git isn't installed on this device, so version control stays off.")
        return {"spaces": service.enable_all()}

    @r.post("/commit")
    def post_commit(req: TargetRequest):
        try:
            sha = service.commit_now(need(req.target))
            return {"commit": sha, "status": status(req.target)}
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.put("/remote")
    def put_remote(req: RemoteRequest):
        try:
            t = need(req.target)
            if req.url.strip() or req.branch is not None or req.autoPush is None:
                service.set_remote(t, req.url, req.branch, req.autoPush)
            else:
                service.set_auto_push(t, req.autoPush)
            return status(req.target)
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.post("/push")
    def post_push(req: TargetRequest):
        try:
            service.push_now(need(req.target))
            return status(req.target)
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.post("/fetch")
    def post_fetch(req: TargetRequest):
        try:
            service.fetch(need(req.target))
            return status(req.target)
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.put("/settings")
    def put_settings(req: SettingsRequest):
        try:
            return service.set_settings(req.commitDelaySeconds, req.pushDelaySeconds)
        except VcsRefused as exc:
            return refused(exc)

    @r.get("/log")
    def get_log(limit: int = 50, skip: int = 0, target: str = TARGET_SPACE):
        try:
            t = target_of(target)
            if t is None or not (t.root / ".git").exists():
                return {"commits": [], "more": False}
            limit = max(1, min(limit, 200))
            commits = vcs.log(t.root, limit=limit + 1, skip=max(0, skip))
            return {"commits": commits[:limit], "more": len(commits) > limit}
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.get("/diff")
    def get_diff(sha: str, path: str | None = None, target: str = TARGET_SPACE):
        try:
            t = target_of(target)
            if t is None or not (t.root / ".git").exists():
                return _error(404, "This space has no version history yet.")
            full = vcs.resolve_commit(t.root, sha)
            if full is None:
                return _error(404, f'There is no commit "{sha}" in this space\'s history.')
            return {"sha": full, "files": vcs.show(t.root, full, vcs.posix(path) if path else None)}
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.post("/restore")
    def post_restore(req: RestoreRequest):
        try:
            t = need(TARGET_SPACE)
            result = service.restore_space(t, req.sha)
            return {**result, "status": status(TARGET_SPACE)}
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    def object_rel(path: str) -> str:
        rel = space._rel(path)
        if not (space.root / rel).is_file():
            raise KeyError(rel)
        return rel

    @r.get("/file-log")
    def get_file_log(path: str):
        try:
            rel = object_rel(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except KeyError:
            return _error(404, f'There is no object at "{path}".')
        try:
            t = target_of(TARGET_SPACE)
            if t is None or not (t.root / ".git").exists():
                return {"versions": []}
            return {"versions": vcs.file_log(t.root, rel)}
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    def source_bytes(t: RepoTarget, sha: str, rel: str, source: str | None) -> tuple[str, bytes]:
        full = vcs.resolve_commit(t.root, sha)
        if full is None:
            raise VcsRefused(f'There is no commit "{sha}" in this space\'s history.', 404)
        candidates = [vcs.posix(source)] if source else []
        if not source:
            for v in vcs.file_log(t.root, rel):
                if v["sha"] == full:
                    candidates.append(v["path"])
            candidates.append(rel)
        for c in candidates:
            if c.startswith("/") or ".." in PurePosixPath(c).parts:
                continue
            data = vcs.file_at(t.root, full, c)
            if data is not None:
                return full, data
        raise VcsRefused(f'The commit "{sha[:12]}" has no version of this object.', 404)

    @r.get("/file")
    def get_file(sha: str, path: str, sourcePath: str | None = None):
        try:
            rel = object_rel(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except KeyError:
            return _error(404, f'There is no object at "{path}".')
        try:
            t = target_of(TARGET_SPACE)
            if t is None:
                return _error(404, "This space has no version history yet.")
            full, data = source_bytes(t, sha, rel, sourcePath)
            from .textfile import decode

            return {"sha": full, "text": decode(data).text}
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)

    @r.post("/file-restore")
    def post_file_restore(req: FileRestoreRequest):
        from .history import keep_identity
        from .space import version_of

        try:
            rel = object_rel(req.path)
        except ValueError as exc:
            return _error(400, str(exc))
        except KeyError:
            return _error(404, f'There is no object at "{req.path}".')
        try:
            t = need(TARGET_SPACE)
            full, old = source_bytes(t, req.sha, rel, req.sourcePath)
            with t.busy, service._write_lock(t):
                current = (space.root / rel).read_bytes()
                if version_of(current) != req.baseVersion:
                    return JSONResponse({"currentVersion": version_of(current)}, status_code=409)
                service._commit(t)  # what's pending first, so nothing is lost
                new = keep_identity(old, current)
                version = version_of(current)
                if new != current:
                    if not space._write_exact(rel, req.baseVersion, new):
                        now = (space.root / rel).read_bytes()
                        return JSONResponse({"currentVersion": version_of(now)}, status_code=409)
                    version = version_of(new)
                info = vcs.run(t.root, ["log", "-1", "--format=%h%x1f%aI", full], read_only=True)
                short, _, at = vcs._text(info.out).strip().partition("\x1f")
                title = PurePosixPath(rel).stem
                commit = service.commit_file(t, rel, f'Object: restore "{title}" to {short} ({vcs.short_date(at)})\n')
        except (VcsRefused, vcs.GitFailed, vcs.GitMissing) as exc:
            return refused(exc)
        ctx.announce(ChangeEvent("changed", rel, version, origin=req.clientId))
        return {"version": version, "commit": commit}

    return r
