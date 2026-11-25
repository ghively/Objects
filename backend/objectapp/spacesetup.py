"""Applying a starting point to an open `Space`: basic, blank and the IT ops set.

`basicsetup` builds the starters as data, against a space root; these are `Space`'s
sides of the M8 "Pick a starting point" pick, moved out of `space.py` as free
functions over the open space (`Space` keeps thin delegating methods): writing and
loading what the pick brings, the ``setup`` marker in ``space.json`` (M32: the app
no longer asks; the starters are also added later, from the type gallery), and the
default template an IT ops type made from the gallery gets.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from . import spaceconfig
from .propvalues import InvalidValue
from .typemodel import TypeDefinition, TypeReadOnly

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "add_itops_template",
    "apply_setup",
    "ids_by_name",
    "itops_setup",
]

_log = logging.getLogger(__name__)


def apply_setup(space: Space, setup: str) -> list[str]:
    """Fix pass H2: apply M8's "Pick a starting point" to this (new or empty) space.

    ``basic`` writes the Person, Meeting, Project and Book types (`basicsetup`) and loads
    them; M28: ``itops`` writes the IT ops types, their default templates and the seed Tags
    (`basicsetup.write_itops_types`, `write_itops_tags`), never replacing a file that is
    there (a type id the space has already is left out); ``blank`` writes nothing else.
    Either way ``space.json`` records the pick (``setup``), so the space is asked once.
    Returns the space-relative paths of the objects written (templates and Tags), for the
    caller to announce. Raises `ValueError` for another value.

    M32: the app no longer asks; a new or empty folder gets ``blank``, and the two starters
    are also added later, from the type gallery. So a starter leaves out a type whose
    **name** the space has already (under another id) as well, pointing its relations at
    that type; a space that was still new (`spaceconfig.needs_setup`) gets its built-in
    Task and DailyNote types written too (the pick is what makes the space); and a later
    ``basic`` leaves an ``itops`` marker as it is. The basic Project carries the ticket and
    work fields only while Work is on for the space (`work_on`); ``itops`` turns Work on
    (``workEnabled: true`` beside the marker) unless the user already set the switch.
    """
    from .basicsetup import basic_types, retarget_relations
    from .typemodel import ON_DEMAND_TYPES

    if setup not in ("basic", "blank", "itops"):
        raise ValueError(f"Unknown space setup: {setup!r}")
    created: list[str] = []
    with space._lock:
        fresh = spaceconfig.needs_setup(space.root)
        if setup == "basic":
            taken = {t.id for t in space.types} | {u.id for u in space.unreadable_types}
            named = ids_by_name(space)
            # M32: Project gets the ticket and work fields only while Work is on here.
            starter = basic_types(work=space.work_on())
            retarget = {t.id: named[t.name.lower()] for t in starter
                        if t.id not in taken and t.name.lower() in named}  # fmt: skip
            types_dir = space.root / ".object" / "types"
            for t in starter:
                if t.id in taken or t.id in retarget:
                    continue
                if (types_dir / f"{t.id}.json").exists():
                    # A type file put there since the space was opened (a sync, by hand)
                    # and not loaded: never replaced, as `write_itops_types` leaves it.
                    continue
                retarget_relations(t, retarget)
                space._write_type_json(t, "")
                space.types.append(t)
                space._types_changed(t.id)
            space._sort_types()
        elif setup == "itops":
            created = itops_setup(space)
        if fresh:
            for type_id in ON_DEMAND_TYPES:
                builtin = space.type_by_id(type_id)
                if builtin is not None and builtin.basic:
                    space._persist_type(builtin)
        config = spaceconfig.read(space.root)[0]
        marker = config.get("setup")
        # A set asked for again finds its marker (and, for the IT operations set, a Work
        # switch) already there: space.json is not written again.
        settled = marker == setup and (
            setup != "itops" or isinstance(config.get("workEnabled"), bool)
        )
        if not (setup == "basic" and marker == "itops") and not settled:
            # M32: the IT operations starter turns Work on for its space (unless the user
            # already set the switch), in the same write as the marker.
            spaceconfig.set_internal(
                space.root, "setup", setup, work_default=True if setup == "itops" else None
            )
        space.work_on()  # the Task type follows a switch this turned on
    return created


def ids_by_name(space: Space) -> dict[str, str]:
    """Lower-cased type name -> the id of the (first) type of that name."""
    out: dict[str, str] = {}
    for t in space.types:
        out.setdefault(t.name.lower(), t.id)
    return out


def itops_setup(space: Space) -> list[str]:
    """Write and load the IT ops types, templates and seed Tags; return the objects' paths."""
    from .basicsetup import write_itops_tags, write_itops_types

    taken = {t.id for t in space.types} | {u.id for u in space.unreadable_types}
    written = [
        *write_itops_types(space.root, skip=taken, named=ids_by_name(space)),
        *write_itops_tags(space.root),
    ]
    types_dir = space.root / ".object" / "types"
    created: list[str] = []
    loaded: list[str] = []
    for full in written:
        if full.parent == types_dir and full.suffix == ".json":
            t = space._stored_type(full.stem)
            if t is not None:
                # M32: listed as a load lists it (a switch the user set off stays off).
                space._top_up(t)
                space.types = [x for x in space.types if x.id != t.id]
                space.types.append(t)
                loaded.append(t.id)
        else:
            created.append(full.relative_to(space.root).as_posix())
    space._sort_types()
    for type_id in loaded:
        space._types_changed(type_id)
    # The templates and Tags after the types, so each file is read as its type's.
    for rel in created:
        space.rescan_file(rel)
    return created


def add_itops_template(space: Space, t: TypeDefinition, key: str) -> None:
    """M28: an IT ops type made from the gallery (``key`` in `ITOPS_TYPE_IDS`) gets its
    default template (named as the type, with the type's sections) as the starter writes
    it; the older gallery entries get none. A template that can't be made never fails the
    type's creation."""
    from .basicsetup import ITOPS_TEMPLATE_SECTIONS, ITOPS_TYPE_IDS, itops_template

    if key not in ITOPS_TYPE_IDS or key not in ITOPS_TEMPLATE_SECTIONS:
        return
    _name, body = itops_template(key)
    try:
        space.create_template(t.id, t.name, body=body, default=True)
    except (InvalidValue, TypeReadOnly, KeyError, OSError):
        _log.warning("Type %s is created without its default template", t.id, exc_info=True)
