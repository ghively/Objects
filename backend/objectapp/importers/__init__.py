"""M15 importers: a Notion Markdown & CSV export, an Obsidian vault or an Anytype Markdown
export read into an `ImportPlan` (a dry run that writes nothing), previewed, then written into
a new space (or, when the user explicitly picks it, the open one) by one common writer.

The contract is ``docs/superpowers/plans/2026-11-05-m15-importers.md``; the shared models are
in `model`. Lane B fills the readers (``notion``, ``obsidian``, ``anytype``), the source access
(``source``), detection, kind guessing, the writer, the report and the jobs.
"""
