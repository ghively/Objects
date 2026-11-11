// The Work page (M32: the dashboard is its own, optional page again, the `work` target while Work
// is on for the space; the plain Tasks page is `tasks/TasksPage`). As Gene's redesign of M23 left
// it: the header ("Work", search, Create task), the brain-dump bar, the focus rail (when today has
// focus lines), then the grouped view switcher, and the selected view. The task lists (Inbox,
// Scheduled, ...) are views here too (`work/tasklists/registerView.ts`); Today is the day timeline
// with today's tasks.
// The Task rows load once for the page (`useTaskRowsFeed`). Every
// dashboard view is computed from `useWorkData`; the page's own state (energy, Just one thing,
// view, the focus line) is `useWorkUi`, browser storage only. While the space hides task management
// (`space.json` `hideTaskManagement`) the task lists are left out and the dashboard stays (M23's Work).
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { WorkBoard, WorkBoardItem, WorkViewId } from '@/api/types'
import { Icon } from '@/components/Icon'
import { createAndOpen } from '@/create/createAndOpen'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { zonedParts } from '@/lib/zonedTime'
import { TASKS_TEXT } from '@/tasks/TasksPage'
import { useTaskRows, useTaskRowsFeed } from '@/tasks/useTaskRows'
import { useWorkKeys } from '../keys/useWorkKeys'
import { DEFAULT_PARTS, useWorkData, useWorkEvents, type WorkDataState, type WorkPart } from '../state/useWorkData'
import { useWorkUi } from '../state/useWorkUi'
import { isTaskListView } from '../tasklists/registerView'
import { workViews } from '../views/registry'
import { WORK_TEXT } from '../workText'
import { BrainDumpBar, focusBrainDumpField } from './BrainDumpBar'
import { FocusRail } from './FocusRail'
import { ViewSwitcher } from './ViewSwitcher'
import { clearWorkSearch, focusSearchField, useWorkSearch, WorkControls, WorkSearch } from './WorkTopBar'

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
  // Phase 2: the page's one Task rows feed (every list view and the count badges read it).
  useTaskRowsFeed()
  useTaskRows((s) => s.rows)
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

  // "Hide Tasks in this space": M32, the app shows `tasks/TasksHidden` in place of this page then
  // (`App.pageFor`), so this only matters where the page is rendered on its own: the task lists
  // are left out, as before.
  const hideTasks = useSpaceInfo((s) => s.space?.hideTaskManagement ?? false)
  const all = hideTasks ? workViews().filter((v) => !isTaskListView(v.id)) : workViews()
  const shown = calm ? all.filter((v) => v.id === 'now') : all
  const current = shown.find((v) => v.id === (calm ? 'now' : uiView)) ?? shown[0]
  const currentId: WorkViewId = current?.id ?? 'now'

  const viewData: WorkDataState = useMemo(
    () => (q ? { ...data, board: filterBoard(data.board, q), all: filterBoard(data.all, q) } : data),
    [data, q],
  )

  const View = current?.Component
  const taskType = useTaskRows((s) => s.taskType)
  // The focus rail only when today has focus lines (Now's side keeps its Edit for adding them).
  const hasFocusLines = (data.focus?.lines.length ?? 0) > 0
  return (
    <div data-work-page="" className="h-full min-h-0 overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 pt-5 pb-16">
        <header className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover-2">
            <Icon name="ph-check-circle" size={20} />
          </span>
          <h1 className="dataview-heading min-w-0 shrink-0 text-[20px] font-bold md:text-[22px]">{WORK_TEXT.work}</h1>
          <div className="ml-auto flex min-w-0 shrink items-center">
            <WorkSearch />
          </div>
          <button
            type="button"
            disabled={!taskType}
            onClick={(e) =>
              taskType &&
              void createAndOpen(taskType.id, {}, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }).catch(
                (err: unknown) => console.warn('Could not create a task:', err),
              )
            }
            className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 text-[14px] font-medium hover:bg-hover disabled:opacity-50"
          >
            <Icon name="ph-plus" size={14} />
            {TASKS_TEXT.createTask}
          </button>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[18rem] flex-1">
            <BrainDumpBar view={currentId} />
          </div>
          <WorkControls data={data} />
        </div>
        {hasFocusLines && <FocusRail data={data} now={now} />}
        <ViewSwitcher views={shown} selected={currentId} data={data} now={now} />
        <div data-work-view-body={currentId} className="min-h-0 flex-1">
          {View ? <View data={viewData} now={now} /> : null}
        </div>
      </div>
    </div>
  )
}
