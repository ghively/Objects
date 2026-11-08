// Month: the strip Jan to Dec (the shown month highlighted; a click jumps to that month's first
// day), then the month's daily notes as grid cards (M3's grid layout) in date order, loaded with one
// `api.rows({paths})` call per range load, and a "+ New Object" row under them. No cell calendar.
// With no notes in the month the cards are replaced by "This month has no daily notes yet."
// and the empty-state hint.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, DailyNoteExistsError } from '@/api/client'
import type { Layout, Row, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { ensureLinkIndex, invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { DataView } from '@/views/DataView'
import { emptyFilterGroup } from '@/views/model'
import { monthName, rangeFor, todayYmd, type Day } from './dates'
import type { MultiDayViewProps } from './ThreeDaysView'
import { useCalendar } from './useCalendar'
import { useCalendarRange } from './useCalendarRange'

export const MONTH_TEXT = {
  empty: 'This month has no daily notes yet.',
  /** Shown under the month's empty line. */
  emptyHint: 'You can change this by creating a new object.',
  /** Capitalised in the Month view ("New Object", not "New object"). */
  newObject: 'New Object',
  /** Our string: the month strip's accessible name. */
  months: 'Months',
}

/**
 * The day "+ New Object" creates (or opens, when it exists) a daily note for: today when the shown
 * month is this month, else the month's first day (our choice).
 */
export function newObjectDay(monthFrom: Day, today: Day): Day {
  return today.slice(0, 7) === monthFrom.slice(0, 7) ? today : monthFrom
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
  const { data, reload } = useCalendarRange(range)
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

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const createNote = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const day = newObjectDay(range.from, data?.today ?? todayYmd())
    try {
      const res = await api.createDailyNote(day)
      void invalidateLinkIndex()
      usePeek.getState().peek(res.path)
    } catch (e) {
      if (e instanceof DailyNoteExistsError && e.reason === 'exists' && e.path) usePeek.getState().peek(e.path)
      else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      reload()
    }
  }

  const empty = !!paths && paths.length === 0
  const shown = rows && rows.key === key ? rows.rows : []
  return (
    <div data-testid="month-view" className="mx-auto flex w-full max-w-[50rem] flex-col gap-6 px-6 pt-10 pb-24">
      <MonthStrip from={range.from} />
      {empty ? (
        <div className="flex flex-col gap-1">
          <p className="text-[15px] text-fg-muted">{MONTH_TEXT.empty}</p>
          <p className="text-[14px] text-fg-muted">{MONTH_TEXT.emptyHint}</p>
        </div>
      ) : (
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
      )}
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void createNote()}
          className="flex h-9 w-full items-center gap-1.5 rounded-lg px-2 text-[15px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-plus" size={15} />
          {MONTH_TEXT.newObject}
        </button>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

/** Jan to Dec of the shown year; the shown month is highlighted, a click opens a month at its 1st. */
function MonthStrip({ from }: { from: Day }) {
  const setAnchor = useCalendar((s) => s.setAnchor)
  const year = from.slice(0, 4)
  const current = Number(from.slice(5, 7))
  return (
    <nav aria-label={MONTH_TEXT.months} className="flex flex-wrap items-center gap-1">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const active = m === current
        return (
          <button
            key={m}
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => setAnchor(`${year}-${String(m).padStart(2, '0')}-01`)}
            className={cn(
              'h-8 rounded-lg px-2.5 text-[14px] hover:bg-hover hover:text-fg',
              active ? 'bg-hover font-semibold text-fg' : 'text-fg-muted',
            )}
          >
            {monthName(m).slice(0, 3)}
          </button>
        )
      })}
    </nav>
  )
}
