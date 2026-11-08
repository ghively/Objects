// M23 Task 9: the Work page: the top bar, the brain-dump bar and the focus rail on every view, then
// the view switcher and the selected view. Every view is computed from `useWorkData`; the page's
// own state (energy, Just one thing, view, the focus line) is `useWorkUi`, browser storage only.
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { WorkBoard, WorkBoardItem, WorkViewId } from '@/api/types'
import { zonedParts } from '@/lib/zonedTime'
import { useWorkKeys } from '../keys/useWorkKeys'
import { DEFAULT_PARTS, useWorkData, useWorkEvents, type WorkDataState, type WorkPart } from '../state/useWorkData'
import { useWorkUi } from '../state/useWorkUi'
import { workViews } from '../views/registry'
import { BrainDumpBar, focusBrainDumpField } from './BrainDumpBar'
import { FocusRail } from './FocusRail'
import { ViewSwitcher } from './ViewSwitcher'
import { clearWorkSearch, focusSearchField, useWorkSearch, WorkTopBar } from './WorkTopBar'

// A later milestone's views register themselves (`work/<folder>/registerView.ts`, M24's Captures).
import.meta.glob('../*/registerView.ts', { eager: true })

export { registerWorkView, WORK_VIEWS, workViews } from '../views/registry'
export type { WorkViewDef, WorkViewProps } from '../views/registry'
export { clearWorkSearch }

/** What the page loads on mount: the default parts plus the ones its counts need. */
const PAGE_PARTS: readonly WorkPart[] = [...DEFAULT_PARTS, 'wins', 'general']

/** What a new day reloads: everything stamped with the server's "today". */
const DAY_PARTS: readonly WorkPart[] = ['board', 'focus', 'today', 'needsYou']

/** The clock the views read, moved on once a minute. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

const matches = (i: WorkBoardItem, q: string): boolean =>
  [i.title, i.ticket?.id ?? '', i.area ?? ''].some((s) => s.toLowerCase().includes(q))

const filterBoard = (b: WorkBoard | null, q: string): WorkBoard | null =>
  b ? { ...b, items: b.items.filter((i) => matches(i, q)) } : b

/** Focus the brain-dump bar (`B`). */
export function focusBrainDump(): void {
  focusBrainDumpField()
}

/** Focus the search (`/`). */
export function focusWorkSearch(): void {
  focusSearchField()
}

/** The Work section's page, on `view` (a `{kind: 'work', view}` target). */
export function WorkPage({ view }: { view?: WorkViewId }): JSX.Element {
  useWorkEvents()
  useWorkKeys()
  const data = useWorkData()
  const now = useNow()
  const calm = useWorkUi((s) => s.calm)
  const uiView = useWorkUi((s) => s.view)
  // Subscribed so the counts and the rail follow the energy, Not now and the focus line.
  useWorkUi((s) => s.energy)
  useWorkUi((s) => s.notNow)
  useWorkUi((s) => s.focusLine)
  const q = useWorkSearch((s) => s.q).trim().toLowerCase()

  useEffect(() => {
    void useWorkData.getState().load(PAGE_PARTS)
  }, [])

  // Left open overnight: once the wall-clock day in the board's zone passes the board's "today", the
  // day's parts are loaded again, once per stale day (the server's answer moves `today` on).
  const boardToday = data.board?.today ?? null
  const boardZone = data.board?.timeZone ?? null
  const rolledFor = useRef<string | null>(null)
  useEffect(() => {
    if (!boardToday) return
    if (zonedParts(now, boardZone).date === boardToday) return
    if (rolledFor.current === boardToday) return
    rolledFor.current = boardToday
    void useWorkData.getState().load(DAY_PARTS)
  }, [now, boardToday, boardZone])

  // A `{kind: 'work', view}` target opens that view.
  useEffect(() => {
    if (view) useWorkUi.getState().setView(view)
  }, [view])

  // Just one thing dims the app while the page shows.
  useEffect(() => {
    if (!calm) return
    const html = document.documentElement
    html.setAttribute('data-work-calm', '')
    return () => html.removeAttribute('data-work-calm')
  }, [calm])

  // A new visit starts with no search.
  useEffect(() => () => clearWorkSearch(), [])

  const all = workViews()
  const shown = calm ? all.filter((v) => v.id === 'now') : all
  const current = shown.find((v) => v.id === (calm ? 'now' : uiView)) ?? shown[0]
  const currentId: WorkViewId = current?.id ?? 'now'

  const viewData: WorkDataState = useMemo(
    () => (q ? { ...data, board: filterBoard(data.board, q), all: filterBoard(data.all, q) } : data),
    [data, q],
  )

  const View = current?.Component
  return (
    <div data-work-page="" className="flex h-full min-h-0 flex-col gap-3 overflow-auto px-6 py-4">
      <WorkTopBar data={data} />
      <BrainDumpBar view={currentId} />
      <FocusRail data={data} now={now} />
      <ViewSwitcher views={shown} selected={currentId} data={data} now={now} />
      <div data-work-view-body={currentId} className="min-h-0 flex-1">
        {View ? <View data={viewData} now={now} /> : null}
      </div>
    </div>
  )
}
