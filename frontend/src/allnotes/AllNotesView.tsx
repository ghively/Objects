// "All notes" (M32): every note by when it was last edited, newest first, grouped
// Today / Yesterday / This week / Earlier. Daily notes are in; tasks, tags and templates are left
// out (`notes.ts`). A sort or a grouping picked in the toolbar takes over for as long as it is set.
// The layout is saved to `ui.allNotesLayout`.
import { useCallback, useMemo, useState } from 'react'
import type { Layout, Row, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { ALL_NOTES } from '@/lib/words'
import { useZonedToday } from '@/lib/zonedShell'
import { useLinkIndex } from '@/links/linkIndex'
import { usePinned, saveAllNotesLayout, useUiStore } from '@/shell/usePinned'
import { useDefinitions } from '@/types/useDefinitions'
import { DataView, type Pipeline } from '@/views/DataView'
import { applyFilters } from '@/views/filter'
import { groupRows } from '@/views/group'
import { ALL_NOTES_LAYOUTS } from '@/views/model'
import { applySorts } from '@/views/sort'
import { useRows } from '@/views/useRows'
import { byEditedDesc, editedAt, editedDay, editedGroup, editedLabel, isListedNote, isListedType, NOTES_GROUPS } from './notes'

export const ALL_NOTES_TEXT = {
  heading: ALL_NOTES,
  description: 'Every note, by when it was last edited.', // our string
  emptyTitle: 'No notes yet',
  emptyBody: 'New notes show up here.',
}

const initial = (layout: Layout): ViewState => ({
  viewDefinition: { dataViewLayout: layout },
  filterGroup: { type: 'filterGroup', operator: 'and', elements: [] },
  sorts: [],
  groupBy: null,
})

/**
 * The view's filters, then the notes by last edit under Today / Yesterday / This week / Earlier
 * (empty groups left out). With a sort or a grouping of the user's own, the standard pipeline.
 */
export function notesPipeline(today: string): Pipeline {
  return (rows, state, ctx) => {
    const filtered = applyFilters(rows, state.filterGroup, ctx)
    if (state.groupBy || state.sorts.length > 0) {
      const sorted = applySorts(filtered, state.sorts, ctx)
      const g = groupRows(sorted, state.groupBy, state.viewDefinition.groupByConfig, ctx)
      return { rows: sorted, groups: g.groups, hidden: g.hidden }
    }
    const sorted = [...filtered].sort((a, b) => byEditedDesc(a.summary, b.summary))
    const groups = NOTES_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      rows: sorted.filter((r) => editedGroup(editedDay(editedAt(r.summary)), today) === g.id),
    })).filter((g) => g.rows.length > 0)
    return { rows: groups.flatMap((g) => g.rows), groups }
  }
}

export function AllNotesView() {
  usePinned() // loads `ui.json`
  const layout = useUiStore((s) => s.ui.allNotesLayout) ?? 'list'
  const types = useLinkIndex((s) => s.types)
  const { collections } = useDefinitions()
  const [local, setLocal] = useState<ViewState>(() => initial(layout))
  const today = useZonedToday()

  const typesById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const typeIds = useMemo(() => types.filter((t) => isListedType(t, t.id)).map((t) => t.id), [types])
  const { rows, loading, patchRow } = useRows(typeIds.length > 0 ? { typeIds } : {})
  const shown = useMemo(() => (rows ?? []).filter((r) => isListedNote(r.summary, typesById)), [rows, typesById])
  const pipeline = useMemo(() => notesPipeline(today), [today])
  // A list row ends with when the note was edited.
  const rowExtras = useCallback(
    (r: Row) => ({
      trailing: (
        <time dateTime={editedAt(r.summary)} className="text-[13px] text-fg-muted tabular-nums">
          {editedLabel(editedAt(r.summary), today)}
        </time>
      ),
    }),
    [today],
  )

  const state: ViewState = { ...local, viewDefinition: { ...local.viewDefinition, dataViewLayout: layout } }
  const onState = (next: ViewState) => {
    setLocal(next)
    const l = next.viewDefinition.dataViewLayout
    if (l !== layout && (ALL_NOTES_LAYOUTS as readonly string[]).includes(l)) {
      void saveAllNotesLayout(l as 'list' | 'grid' | 'wall' | 'embed')
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-5 pb-16">
      <header className="pb-4">
        <div className="flex items-center gap-2.5">
          <Icon name="ph-note" size={20} />
          <h1 className="dataview-heading min-w-0 flex-1 text-[20px] font-bold md:text-[22px]">{ALL_NOTES_TEXT.heading}</h1>
        </div>
        <p className="mt-1 text-[14px] text-fg-muted">{ALL_NOTES_TEXT.description}</p>
      </header>
      <DataView
        rows={shown}
        types={types}
        collections={collections}
        scope={typeIds.length > 0 ? { typeIds } : undefined}
        loading={loading}
        state={state}
        onState={onState}
        layouts={ALL_NOTES_LAYOUTS}
        patchRow={patchRow}
        pipeline={pipeline}
        rowExtras={rowExtras}
        emptyState={
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <p className="text-[15px] text-fg">{ALL_NOTES_TEXT.emptyTitle}</p>
            <p className="text-[14px] text-fg-muted">{ALL_NOTES_TEXT.emptyBody}</p>
          </div>
        }
      />
    </div>
  )
}
