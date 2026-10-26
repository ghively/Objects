// Month: the month's daily notes as grid cards (M3's grid layout) in date order, loaded with one
// `api.rows({paths})` call per range load. No cell calendar. With no notes in the month the only
// content is "No daily notes created for this month." (`components.RootDailyNote.emptyStates.month`).
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { Layout, Row, ViewState } from '@/api/types'
import { ensureLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { DataView } from '@/views/DataView'
import { emptyFilterGroup } from '@/views/model'
import { rangeFor } from './dates'
import type { MultiDayViewProps } from './ThreeDaysView'
import { useCalendarRange } from './useCalendarRange'

export const MONTH_TEXT = {
  /** `components.RootDailyNote.emptyStates.month` */
  empty: 'No daily notes created for this month.',
}

const GRID: readonly Layout[] = ['grid']

const gridView = (): ViewState => ({
  viewDefinition: { dataViewLayout: 'grid' },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

export function MonthView({ anchor, weekStart }: MultiDayViewProps) {
  const range = useMemo(() => rangeFor('month', anchor, weekStart), [anchor, weekStart])
  const { data } = useCalendarRange(range)
  const types = useLinkIndex((s) => s.types)
  const [view, setView] = useState<ViewState>(gridView)
  const [rows, setRows] = useState<{ key: string; rows: Row[] } | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    void ensureLinkIndex()
  }, [])

  // The month's daily note paths in date order (only days of this month).
  const month = range.from.slice(0, 7)
  const paths = useMemo(() => {
    if (!data) return null
    return Object.keys(data.days)
      .filter((d) => d.slice(0, 7) === month && data.days[d]?.dailyNote)
      .sort()
      .map((d) => data.days[d].dailyNote!.path)
  }, [data, month])
  const key = paths ? paths.join('\n') : null

  useEffect(() => {
    if (!data || !paths) return
    const my = ++seq.current
    if (paths.length === 0) {
      setRows({ key: '', rows: [] })
      return
    }
    api
      .rows({ paths })
      .then((got) => {
        if (my !== seq.current) return
        const byPath = new Map(got.map((r) => [r.summary.path, r]))
        setRows({ key: paths.join('\n'), rows: paths.map((p) => byPath.get(p)).filter((r): r is Row => !!r) })
      })
      .catch((e: unknown) => console.warn('Could not load the month:', e))
  }, [data, paths])

  if (paths && paths.length === 0) {
    return (
      <div data-testid="month-view" className="mx-auto w-full max-w-[50rem] px-6 pt-10 pb-24">
        <p className="text-[15px] text-fg-muted">{MONTH_TEXT.empty}</p>
      </div>
    )
  }

  const shown = rows && rows.key === key ? rows.rows : []
  return (
    <div data-testid="month-view" className="mx-auto w-full max-w-[50rem] px-6 pt-10 pb-24">
      <DataView
        rows={shown}
        types={types}
        scope={{ typeIds: ['dailynote'] }}
        loading={!rows || rows.key !== key}
        state={view}
        onState={setView}
        layouts={GRID}
        embedded
        compact
      />
    </div>
  )
}
