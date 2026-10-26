// "All notes": every object except daily notes and tasks, grouped by when it was created
// (newest first). The layout is saved to `ui.allNotesLayout`.
import { useMemo, useState } from 'react'
import type { Layout, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useLinkIndex } from '@/links/linkIndex'
import { usePinned, saveAllNotesLayout, useUiStore } from '@/shell/usePinned'
import { useDefinitions } from '@/types/useDefinitions'
import { DataView } from '@/views/DataView'
import { ALL_NOTES_LAYOUTS } from '@/views/model'
import { useRows } from '@/views/useRows'

export const ALL_NOTES_TEXT = {
  heading: 'All notes',
  description: 'All notes in this space, grouped by when they were created.',
  emptyTitle: 'No notes yet',
  emptyBody: 'Notes you create will appear here.',
}

/** The types All notes leaves out. */
const EXCLUDED = new Set(['dailynote', 'task'])

const initial = (layout: Layout): ViewState => ({
  viewDefinition: { dataViewLayout: layout },
  filterGroup: { type: 'filterGroup', operator: 'and', elements: [] },
  sorts: [],
  groupBy: { groups: [{ propertyId: 'createdAt', option: 'relative' }], sortOption: 'defaultDescending' },
})

export function AllNotesView() {
  usePinned() // loads `ui.json`
  const layout = useUiStore((s) => s.ui.allNotesLayout) ?? 'list'
  const types = useLinkIndex((s) => s.types)
  const { collections } = useDefinitions()
  const [local, setLocal] = useState<ViewState>(() => initial(layout))

  const typeIds = useMemo(() => types.filter((t) => !EXCLUDED.has(t.id)).map((t) => t.id), [types])
  const { rows, loading, patchRow } = useRows(typeIds.length > 0 ? { typeIds } : {})
  const shown = useMemo(() => (rows ?? []).filter((r) => !EXCLUDED.has(r.summary.type)), [rows])

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
