"""Settings > Editor's "N notes begin with a heading that repeats their title." (M33, choice 5).

- ``GET /api/space/title-headings`` -> ``{count}``: how many notes begin with a heading that
  repeats their title (`titleheadings`, which says which notes count and which kinds are left
  out). Answered from the texts the open space already holds: no file is read, nothing is
  written, nothing is announced.
- ``POST /api/space/title-headings/remove`` -> ``{changed}``: takes that one line (and at most
  one blank line after it) out of each such note through the ordinary body write, the text as it
  was kept in version history first. Every window is told: a ``changed`` event per note, with no
  origin (the asking window refreshes too), or one resync (``types`` at ``*``, as the watcher
  and an import send) when more than `titleheadings.RESYNC_AFTER` notes changed. A second call
  changes nothing. When the folder refuses the writes the answer is the one any write gives
  there (503, `server`'s `OSError` handler); a single note that can't be written is skipped and
  is still counted afterwards.

No request body, no setting: nothing is removed unless this route is called.
"""

from __future__ import annotations

from fastapi import APIRouter

from . import titleheadings
from .apictx import ApiContext
from .watcher import RESYNC_PATH, ChangeEvent

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    space = ctx.space
    r = APIRouter()

    @r.get("/space/title-headings")
    def get_title_headings():
        return {"count": titleheadings.count(space)}

    @r.post("/space/title-headings/remove")
    def remove_title_headings():
        changed = titleheadings.remove(space)
        if len(changed) > titleheadings.RESYNC_AFTER:
            ctx.announce(ChangeEvent("types", RESYNC_PATH, None))
        else:
            for rel, version in changed:
                ctx.announce(ChangeEvent("changed", rel, version))
        return {"changed": len(changed)}

    return r
