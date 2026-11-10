"""The M15 import models: the API's request and response shapes (pydantic, mirrored in
``frontend/src/api/types.ts``) and the in-memory `ImportPlan` the readers build and the writer
consumes (dataclasses). See ``docs/superpowers/plans/2026-11-05-m15-importers.md``.

Nothing here reads or writes a file. Field names match the TypeScript side exactly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Literal

from pydantic import BaseModel, Field

__all__ = [
    "IMPORT_KINDS",
    "SKIP_REASONS",
    "CurrentSpaceTarget",
    "ImportCounts",
    "ImportJob",
    "ImportKind",
    "ImportMapping",
    "ImportPhase",
    "ImportPlan",
    "ImportPreview",
    "ImportResult",
    "ImportSource",
    "ImportSourceKind",
    "ImportTarget",
    "NewSpaceTarget",
    "PlanAttachment",
    "PlanLink",
    "PlanObject",
    "PlanProperty",
    "PlanType",
    "PlannedObjectSample",
    "PlannedProperty",
    "PlannedType",
    "PreviewRequest",
    "PropertyOverride",
    "SkipReason",
    "SkippedItem",
    "SpaceCopyTarget",
    "StartImportRequest",
    "StartImportResponse",
    "SystemKey",
    "TypeOverride",
]

# -- vocabulary ---------------------------------------------------------------------

ImportSourceKind = Literal["notion", "obsidian", "anytype", "files"]
"""Which reader reads the source. ``auto`` in a request means "detect it"."""

ImportKind = Literal["text", "number", "boolean", "url", "datetime", "label", "entity"]
"""The property kinds an import can make (a subset of the app's ``PropertyType``)."""

IMPORT_KINDS: tuple[str, ...] = ("text", "number", "boolean", "url", "datetime", "label", "entity")

SystemKey = Literal["title", "tags", "aliases", "description", "createdAt", "lastUpdated"]
"""A source field that fills one of the app's own fields instead of a new property."""

SkipReason = Literal[
    "unsafePath",  # absolute, drive letter, `..`, NUL, or not decodable: never read
    "symlink",  # a link in a folder, or a zip entry marked as one
    "encrypted",  # an encrypted zip entry
    "tooLarge",  # over the per-file limit (Markdown/CSV 20 MiB, attachment 100 MiB)
    "damaged",  # a zip entry that is not what its header says, or unreadable
    "nestedArchive",  # a zip deeper than one level inside the source
    "unsupported",  # a file the reader has no use for (not Markdown, CSV or a linked file)
    "appSettings",  # the source app's own settings (`.obsidian/`, display-only keys)
    "notUtf8",  # imported, with the bad bytes replaced (listed so the user knows)
    "missingAttachment",  # a link or embed to a file that is not in the source
    "unresolvedLink",  # a link to a page that is not in the source (kept as plain text)
    "databaseLink",  # a link to a Notion database (kept as plain text)
    "valueNotConverted",  # a value that doesn't fit the property's kind (dropped)
    "userSkipped",  # left out in the mapping step
    "emptyFile",  # a Markdown file with nothing in it
]

SKIP_REASONS: tuple[str, ...] = SkipReason.__args__  # type: ignore[attr-defined]

ImportPhase = Literal[
    "preparing", "types", "attachments", "objects", "report", "done", "failed", "cancelled"
]


# -- API: requests ------------------------------------------------------------------


class ImportSource(BaseModel):
    path: str
    """An absolute path on this device: a ``.zip`` file or a folder."""
    kind: ImportSourceKind | Literal["auto"] = "auto"


class TypeOverride(BaseModel):
    """The mapping step's changes to one planned type (absent fields: keep the plan's)."""

    name: str | None = None
    pluralName: str | None = None
    skip: bool | None = None
    existingTypeId: str | None = None
    """Only with a ``currentSpace`` target: put these objects into that existing type."""


class PropertyOverride(BaseModel):
    kind: ImportKind | None = None
    isArray: bool | None = None
    name: str | None = None
    skip: bool | None = None


class ImportMapping(BaseModel):
    """The mapping step. A preview answers the effective mapping (defaults filled in)."""

    typeSource: Literal["folder", "key", "none"] = "folder"
    """Obsidian and Anytype: what makes an object's type. Notion ignores it (databases are types)."""
    typeKey: str | None = None
    """The frontmatter key when ``typeSource`` is ``key``."""
    types: dict[str, TypeOverride] = Field(default_factory=dict)
    """Planned type key -> override."""
    properties: dict[str, dict[str, PropertyOverride]] = Field(default_factory=dict)
    """Planned type key -> planned property key -> override."""


class PreviewRequest(BaseModel):
    source: ImportSource
    mapping: ImportMapping | None = None
    target: Literal["newSpace", "currentSpace"] = "newSpace"
    """Which target the preview is for: ``currentSpace`` matches types and titles against the open space."""
    leaveOut: list[str] = Field(default_factory=list)
    """M27: "Leave out" folders and patterns (design section 6): matching files are never read."""
    keepAsSources: bool | None = None
    """M30: plan every page as a Source (None: `sources.keep_as_sources`' default rule, on, as the start)."""


class NewSpaceTarget(BaseModel):
    kind: Literal["newSpace"] = "newSpace"
    name: str
    location: str


class CurrentSpaceTarget(BaseModel):
    kind: Literal["currentSpace"] = "currentSpace"


class SpaceCopyTarget(BaseModel):
    """M25 "Try on a copy of this space": the open space is copied to ``location/name`` and the
    import goes into the copy."""

    kind: Literal["spaceCopy"] = "spaceCopy"
    name: str
    location: str


ImportTarget = Annotated[NewSpaceTarget | CurrentSpaceTarget | SpaceCopyTarget, Field(discriminator="kind")]

KeepOriginals = Literal["attachments", "fileObjects"]


class ScanChoices(BaseModel):
    """What the wizard's scan step hands to the import (design section 6)."""

    leaveOut: list[str] = Field(default_factory=list)
    """Folders and patterns never read."""
    leaveOutFiles: list[str] = Field(default_factory=list)
    """Flagged source paths not imported."""
    excludeFromAi: list[str] = Field(default_factory=list)
    """Flagged source paths imported with ``excludeFromAI: true``."""


class StartImportRequest(BaseModel):
    previewId: str
    mapping: ImportMapping
    target: ImportTarget
    clientId: str | None = None
    keepOriginals: KeepOriginals = "attachments"
    """M25: keep each non-Markdown original as an attachment (default) or as a File object."""
    batch: str | None = None
    """M27: a draft batch (scan, schema proposal) this import adopts; the run is that batch."""
    scan: ScanChoices | None = None
    """M27: the scan step's choices (absent: nothing left out, nothing flagged is excluded)."""
    requireApproved: bool = False
    """M27: refuse a mapping that makes a type no approved proposal makes (the MCP start sets it)."""
    keepAsSources: bool | None = None
    """M30: "Keep pages as Sources" (None: `sources.keep_as_sources`' default rule, on)."""


# -- API: responses -----------------------------------------------------------------


class PlannedProperty(BaseModel):
    key: str
    """The property key the files will use (unique in its type, never a reserved key)."""
    sourceName: str
    """The column header or frontmatter key as the source writes it."""
    name: str
    kind: ImportKind
    guessedKind: ImportKind
    isArray: bool
    systemKey: SystemKey | None = None
    """Set when the field fills one of the app's own fields (then ``kind`` is ignored)."""
    valueCount: int
    unconvertible: int
    """Values that don't fit ``kind`` (dropped and listed in the report)."""
    samples: list[str]
    """Up to 3 distinct values, as the source writes them."""
    options: list[str] = Field(default_factory=list)
    """For ``label``: the distinct texts, first 50."""
    skip: bool = False


class PlannedType(BaseModel):
    key: str
    """Stable within a preview: ``database:<csv path>``, ``folder:<name>``, ``key:<value>``, ``page``."""
    name: str
    pluralName: str
    origin: Literal["database", "folder", "key", "page"]
    originLabel: str
    objectCount: int
    existingTypeId: str | None = None
    skip: bool = False
    properties: list[PlannedProperty]


class SkippedItem(BaseModel):
    path: str
    """Source-relative POSIX path (inside the zip or folder); never an absolute path."""
    reason: SkipReason
    detail: str = ""


class PlannedObjectSample(BaseModel):
    title: str
    typeKey: str
    path: str
    """Where it will be written, relative to the target space."""
    sourcePath: str


class ImportCounts(BaseModel):
    objects: int
    types: int
    properties: int
    attachments: int
    attachmentBytes: int
    links: int
    resolvedLinks: int
    unresolvedLinks: int
    renamed: int
    """Objects whose title was taken (in the import or the target): ``Title (2)``."""
    skipped: int


class ImportPreview(BaseModel):
    previewId: str
    sourcePath: str
    kind: ImportSourceKind
    detected: ImportSourceKind | None
    """What detection found (None: nothing clear; ``kind`` is then what the request named, or ``obsidian``)."""
    container: Literal["zip", "folder"]
    suggestedName: str
    """A name for the new space (the zip's or folder's name, Notion's export prefix dropped)."""
    counts: ImportCounts
    types: list[PlannedType]
    mapping: ImportMapping
    frontmatterKeys: list[tuple[str, int]]
    """Obsidian/Anytype: each frontmatter key with how many files have it (for "type from key")."""
    folders: list[tuple[str, int]]
    """Obsidian/Anytype: each top-level folder with its Markdown file count."""
    samples: list[PlannedObjectSample]
    """The first 20 planned objects."""
    skipped: list[SkippedItem]
    """The first 500 skipped items; ``counts.skipped`` has the total."""
    warnings: list[str]


class StartImportResponse(BaseModel):
    jobId: str
    targetPath: str


class ImportResult(BaseModel):
    targetPath: str
    spaceName: str
    objects: int
    types: int
    attachments: int
    tags: int
    skipped: int
    reportPath: str | None
    """The "Import report" object's space path (None when even that could not be written)."""
    cancelled: bool = False
    batch: str | None = None
    """M25: the batch id (records in ``.object/imports/<batch>/`` of the target space)."""
    updated: int = 0
    unchanged: int = 0
    changedInBoth: int = 0
    removed: int = 0
    leftOut: int = 0
    failed: int = 0
    # of ``failed``, the objects not written because the import stopped (the report's "because the import stopped")
    notWritten: int = 0
    originals: int = 0
    sourceItems: int = 0


class ImportJob(BaseModel):
    id: str
    phase: ImportPhase
    done: int
    total: int
    targetPath: str
    currentPath: str | None = None
    result: ImportResult | None = None
    error: str | None = None


# -- the in-memory plan (readers -> writer) ------------------------------------------


@dataclass
class PlanProperty:
    key: str
    sourceName: str
    name: str
    kind: str  # ImportKind
    guessedKind: str
    isArray: bool = False
    systemKey: str | None = None
    options: list[str] = field(default_factory=list)
    skip: bool = False


@dataclass
class PlanType:
    key: str
    name: str
    pluralName: str
    origin: str  # 'database' | 'folder' | 'key' | 'page'
    originLabel: str
    properties: list[PlanProperty] = field(default_factory=list)
    existingTypeId: str | None = None
    skip: bool = False


@dataclass
class PlanLink:
    """One link or embed in a body or a relation value, as the reader found it."""

    sourcePath: str
    """The linking file (source-relative)."""
    raw: str
    """The link as written (``[text](Page%20abc.md)``, ``[[Note#H|alias]]``, ``![[img.png]]``)."""
    target: str | None
    """The planned object's ``sourcePath`` or the attachment's ``sourcePath``; None: unresolved."""
    kind: Literal["object", "attachment", "database", "external", "unresolved"]
    text: str | None = None
    """The shown text (Markdown link text or wikilink alias), when there is one."""
    heading: str | None = None
    """``#heading`` or ``#^block`` part of a wikilink, kept as written."""
    embed: bool = False


@dataclass
class PlanAttachment:
    sourcePath: str
    size: int
    targetName: str
    """``Attachments/<name>`` it will get (unique, `` (2)`` on a clash; set by the planner)."""


@dataclass
class PlanObject:
    sourcePath: str
    """Source-relative path of the Markdown file; for a Notion CSV row with no page, ``<csv>#<row>``."""
    title: str
    typeKey: str
    values: dict[str, object] = field(default_factory=dict)
    """Planned property key -> raw source value (converted by the writer, by the final kind)."""
    system: dict[str, object] = field(default_factory=dict)
    """SystemKey -> value (tags, aliases, description, createdAt, lastUpdated)."""
    links: list[PlanLink] = field(default_factory=list)
    attachments: list[str] = field(default_factory=list)
    """Source paths of the attachments its body or values use."""
    targetPath: str = ""
    """The space path it will be written to (set by the planner, ``<type folder>/<safe title>.md``)."""
    renamedFrom: str | None = None
    """The title as the source had it, when ``title`` had to change (`` (2)``)."""
    mtime: str | None = None
    """The source file's modification time (UTC ISO), for ``createdAt`` and ``lastUpdated``."""


@dataclass
class ImportPlan:
    """What a reader makes of a source: nothing is written while one is built or kept.

    Bodies are not kept: the writer reads each source file again (the source's fingerprint must
    still match) and rewrites its links with the plan's link table.
    """

    kind: str  # ImportSourceKind
    sourcePath: str
    container: str  # 'zip' | 'folder'
    fingerprint: str
    suggestedName: str
    types: list[PlanType] = field(default_factory=list)
    objects: list[PlanObject] = field(default_factory=list)
    attachments: dict[str, PlanAttachment] = field(default_factory=dict)
    """Source path -> attachment."""
    skipped: list[SkippedItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    frontmatterKeys: dict[str, int] = field(default_factory=dict)
    folders: dict[str, int] = field(default_factory=dict)
