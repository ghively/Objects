# Lane H2 (fix pass H): For Gene

Items from today's acceptance runs that turned out not to be bugs, or need your call. Nothing was built for
these.

## Item 5: "Pages/Alpha" from the search box makes `Pages/Pages.md`

- What happens: the object is titled "Pages/Alpha" and its file is `Pages/Pages.md`.
- Why: that is the specified file-name rule (M2 plan, `safe_filename`, matching the Anytype export): the file
  stem is the title up to its first character that is illegal in a Windows file name (`\ / : * ? " < > |`).
  `What if? A/B: "test"` → `What if.md` is pinned in `backend/tests/test_space.py`. The search box does not
  read `Folder/Title` as a path anywhere in the catalog.
- Options:
  1. Keep it (export parity; the title is kept whole, only the file name is cut).
  2. Drop illegal characters instead of cutting at them for new objects (`Pages/Alpha` → `PagesAlpha.md`).
     Changes the rule for every title, breaks the export match.
  3. Read `X/Title` in the search box's "Create" as "Title in type X" when X is a type's folder.
- Recommendation: 1 (keep). It is rare, the title is right, and option 3 is a new feature with ambiguity.

## Item 6: Wide layout does not widen the editor with the inspector pinned (M9#6)

- Measured live at 1440x900 (`space-m8`, Blocks M8 as a page, inspector pinned, properties panel beside):
  `data-wide` flips true/false correctly, but the content column is 702 px, below the 820 px Normal max
  width, so Wide and Normal draw the same (687 px content). The inspector floats (absolute) and takes no width;
  the narrow column comes from the 370 px Standard properties panel plus the sidebar. Without the panel the
  walkthrough measured 724 ↔ 936.
- Not a bug: Wide removes a max width the column does not reach at that window size.
- Options: (1) keep; (2) let Wide also narrow the gutters (`px-12` → `px-6`) so it always gains a little;
  (3) hide the properties panel in Wide.
- Recommendation: 1 (keep).

## Item 8: "Release type constraint" not found (M9#14)

- It exists: on a **query tab of a type page** (the type page's tab strip `+` → a query), "Edit query" shows the
  locked type chip and the release button (`QueryBuilder` `ConstrainedTypes`, wired in `TypePage`
  `QueryTabEditor`; pinned by `QueryBuilder.m9.test.tsx`). The run used "Save as query", which opens the query
  on its own page — there the type is deliberately not locked (pinned: "on its own page a single-type query is
  not constrained").
- No change. The acceptance box needs the tab path when it is re-run.

## Item 7: block colour from the selection bar (M7#5)

- Harness issue, not a bug: a new test drives the bar's Color > Red text item and the body gets
  `<!-- block: color=text-red -->` (the background case was already pinned). CDP clicks on the Radix item did
  not land in the acceptance run.
