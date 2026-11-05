"""M15 T1: the import contract's shared models and the mounted routes.

Lane B replaces the 501 answers; these tests check only what both lanes rely on: the request
and response shapes (mirrored in ``frontend/src/api/types.ts``) and that the routes exist.
"""

from __future__ import annotations

from objectapp.importers.model import (
    IMPORT_KINDS,
    SKIP_REASONS,
    ImportJob,
    ImportMapping,
    ImportPreview,
    PreviewRequest,
    StartImportRequest,
)
from objectapp.server import create_app
from objectapp.space import Space


def test_preview_request_defaults():
    req = PreviewRequest.model_validate({"source": {"path": "/tmp/export.zip"}})
    assert req.source.kind == "auto"
    assert req.mapping is None
    assert req.target == "newSpace"


def test_start_request_targets():
    new = StartImportRequest.model_validate(
        {
            "previewId": "p1",
            "mapping": {"typeSource": "key", "typeKey": "type"},
            "target": {"kind": "newSpace", "name": "Notes", "location": "/tmp"},
        }
    )
    assert new.target.kind == "newSpace"
    assert new.mapping.typeKey == "type"
    current = StartImportRequest.model_validate(
        {"previewId": "p1", "mapping": {}, "target": {"kind": "currentSpace"}}
    )
    assert current.target.kind == "currentSpace"


def test_mapping_overrides_round_trip():
    m = ImportMapping.model_validate(
        {
            "typeSource": "folder",
            "types": {"folder:Books": {"name": "Book", "pluralName": "Books"}},
            "properties": {"folder:Books": {"rating": {"kind": "number", "skip": False}}},
        }
    )
    dumped = m.model_dump(exclude_none=True)
    assert dumped["types"]["folder:Books"] == {"name": "Book", "pluralName": "Books"}
    assert dumped["properties"]["folder:Books"]["rating"]["kind"] == "number"


def test_preview_shape():
    preview = ImportPreview.model_validate(
        {
            "previewId": "p1",
            "sourcePath": "/tmp/vault",
            "kind": "obsidian",
            "detected": "obsidian",
            "container": "folder",
            "suggestedName": "vault",
            "counts": {
                "objects": 2,
                "types": 1,
                "properties": 1,
                "attachments": 1,
                "attachmentBytes": 10,
                "links": 1,
                "resolvedLinks": 1,
                "unresolvedLinks": 0,
                "renamed": 0,
                "skipped": 1,
            },
            "types": [
                {
                    "key": "folder:Books",
                    "name": "Book",
                    "pluralName": "Books",
                    "origin": "folder",
                    "originLabel": "Books",
                    "objectCount": 2,
                    "properties": [
                        {
                            "key": "rating",
                            "sourceName": "rating",
                            "name": "Rating",
                            "kind": "number",
                            "guessedKind": "number",
                            "isArray": False,
                            "valueCount": 2,
                            "unconvertible": 0,
                            "samples": ["4", "5"],
                        }
                    ],
                }
            ],
            "mapping": {},
            "frontmatterKeys": [["rating", 2]],
            "folders": [["Books", 2]],
            "samples": [
                {"title": "Dune", "typeKey": "folder:Books", "path": "Books/Dune.md", "sourcePath": "Books/Dune.md"}
            ],
            "skipped": [{"path": ".obsidian/app.json", "reason": "appSettings"}],
            "warnings": [],
        }
    )
    assert preview.model_dump()["frontmatterKeys"] == [("rating", 2)]
    assert "datetime" in IMPORT_KINDS and "userSkipped" in SKIP_REASONS


def test_job_shape():
    job = ImportJob.model_validate(
        {"id": "j1", "phase": "objects", "done": 3, "total": 10, "targetPath": "/tmp/Notes"}
    )
    assert job.result is None and job.error is None


def test_import_routes_are_mounted(space_dir):
    app = create_app(Space(space_dir), watch=False)
    paths = set(app.openapi()["paths"])
    for path in (
        "/api/import/preview",
        "/api/import/start",
        "/api/import/jobs/{job_id}",
        "/api/import/jobs/{job_id}/cancel",
    ):
        assert path in paths
