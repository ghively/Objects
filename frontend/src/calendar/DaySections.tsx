// The Day view's sections under the filter tabs: Daily note, Tasks, Objects with this date,
// Created and Updated (Updated is our addition), each a compact `DataView` with its own saved view
// (`ui.calendar.daily.*View`). Rows for every path of the range come from ONE `api.rows` call per
// range load (`useCalendarRows`), never one call per section.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ConflictError } from '@/api/client'
import type { CalendarDay, CalendarRange, DateValue, Layout, Row, TypeDef, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createAndOpen } from '@/create/createAndOpen'
import { ensureLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { cn } from '@/lib/utils'
import { completionToast, type TaskOutcome } from '@/tasks/taskActions'
import { taskRowExtras, type TaskBadge } from '@/tasks/taskRowExtras'
import { DataView, type Pipeline } from '@/views/DataView'
import { applyFilters } from '@/views/filter'
import { groupRows } from '@/views/group'
import { emptyFilterGroup } from '@/views/model'
import { applySorts } from '@/views/sort'
import { useViewState } from '@/views/useViewState'
import { saveCalendarDaily, useCalendarDaily, type CalendarDaily } from './calendarUi'
import { DailyNoteSlot, SectionHeading } from './DailyNoteSlot'
import { addDays, parseYmd, todayYmd, ymd, type Day } from './dates'

export const SECTIONS_TEXT = {
  /** `CalendarDaily.all.heading` */
  all: 'All',
  /** `CalendarDaily.dailyNote.heading` */
  dailyNote: 'Daily note',
  /** `CalendarDaily.tasks.heading` */
  tasks: 'Tasks',
  /** Our short tab label for "Objects with this date". */
  datesTab: 'Dates',
  /** `CalendarDaily.objectsOfDay.heading` */
  dated: 'Objects with this date',
  /** `CalendarDaily.tasks.emptyStateToday` / `.emptyState` */
  noTasksToday: 'No tasks today',
  noTasksOnDay: 'No tasks on this day',
  /** M3's empty state line (`EmptyState.objects.description`). */
  emptyHint: 'You can change this by creating a new object.',
  /** `CalendarDaily.tasks.stats*` */
  statsToday: (open: number, done: number) => `${open} open, ${done} done`,
  statsFuture: (n: number) => `${n} open`,
  statsPast: (n: number) => `${n} done`,
  /** `components.RootTask.overdueWithCount` */
  overdue: (n: number) => `Overdue (${n})`,
  /** `DateGroups.today.title` (the group after Overdue on today). */
  todayGroup: 'Today',
  /** `components.Sidebar.tasks.createTask` */
  createTask: 'Create task',
  /** `CalendarDaily.moveAllTasksTo` */
  moveAll: 'Move all open tasks to',
  today: 'Today',
  tomorrow: 'Tomorrow',
  /** Our string (no Object original). */
  pickDate: 'Pick a date',
  /** Our string. */
  add: 'Add to tasks',
  /** Our string. */
  moveConflict: (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'} changed elsewhere and ${n === 1 ? 'was' : 'were'} not moved.`,
}

/** "Created Today" / "Created Yesterday" / "Created on This Day" (`components.RootDailyNote.created*`). */
export function createdLabel(day: Day, today: Day): string {
  if (day === today) return 'Created Today'
  if (day === addDays(today, -1)) return 'Created Yesterday'
  return 'Created on This Day'
}

/** Our addition, labelled like Created: "Updated Today" / "Updated Yesterday" / "Updated on This Day". */
export function updatedLabel(day: Day, today: Day): string {
  if (day === today) return 'Updated Today'
  if (day === addDays(today, -1)) return 'Updated Yesterday'
  return 'Updated on This Day'
}

export type DayFilter = 'all' | 'dailyNote' | 'tasks' | 'dated' | 'created' | 'updated'

/** The tabs a day shows, in order: Dates and Updated only when the day has entries for them. */
export function dayTabs(day: Day, today: Day, cd: CalendarDay | null): { key: DayFilter; label: string }[] {
  const tabs: { key: DayFilter; label: string }[] = [
    { key: 'all', label: SECTIONS_TEXT.all },
    { key: 'dailyNote', label: SECTIONS_TEXT.dailyNote },
    { key: 'tasks', label: SECTIONS_TEXT.tasks },
  ]
  if (cd && cd.dated.length > 0) tabs.push({ key: 'dated', label: SECTIONS_TEXT.datesTab })
  tabs.push({ key: 'created', label: createdLabel(day, today) })
  if (cd && cd.updated.length > 0) tabs.push({ key: 'updated', label: updatedLabel(day, today) })
  return tabs
}

export function DayTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: DayFilter; label: string }[]
  active: DayFilter
  onSelect(key: DayFilter): void
}) {
  return (
    <div role="tablist" aria-label="Day sections" className="flex flex-wrap items-center gap-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          onClick={() => onSelect(t.key)}
          className={cn(
            'h-9 rounded-lg px-4 text-[15px]',
            t.key === active ? 'bg-hover font-medium text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Every path a range needs a row for: daily notes, tasks, dated, created and updated objects. */
export function rangePaths(data: CalendarRange | null): string[] {
  if (!data) return []
  const out = new Set<string>()
  for (const cd of Object.values(data.days)) {
    if (cd.dailyNote) out.add(cd.dailyNote.path)
    for (const t of cd.tasks) out.add(t.path)
    for (const d of cd.dated) out.add(d.path)
    for (const p of cd.created) out.add(p)
    for (const p of cd.updated) out.add(p)
  }
  return [...out].sort()
}

export interface CalendarRows {
  rows: Row[]
  byPath: Map<string, Row>
  loading: boolean
  patchRow(path: string, row: Row): void
}

/** The rows of a calendar range: one `api.rows({paths})` call each time the range (re)loads. */
export function useCalendarRows(data: CalendarRange | null): CalendarRows {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  useEffect(() => {
    if (!data) return
    const paths = rangePaths(data)
    const my = ++seq.current
    if (paths.length === 0) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    api
      .rows({ paths })
      .then((next) => {
        if (my === seq.current) setRows(next)
      })
      .catch((e: unknown) => console.warn('Could not load the day:', e))
      .finally(() => {
        if (my === seq.current) setLoading(false)
      })
  }, [data])

  const patchRow = useCallback((path: string, row: Row) => {
    setRows((cur) => cur.map((r) => (r.summary.path === path ? row : r)))
  }, [])
  const byPath = useMemo(() => new Map(rows.map((r) => [r.summary.path, r])), [rows])
  return { rows, byPath, loading: loading || !data, patchRow }
}

/** Each task path of the day with every entry kind it stands for (a path is rendered once). */
export function taskBadges(cd: CalendarDay | null): Map<string, TaskBadge[]> {
  const out = new Map<string, TaskBadge[]>()
  for (const t of cd?.tasks ?? []) {
    const have = out.get(t.path) ?? []
    if (!have.includes(t.kind)) have.push(t.kind)
    out.set(t.path, have)
  }
  return out
}

/** The Tasks section's pipeline: the view's filters and sorts, then "Overdue ({count})" first. */
export function overduePipeline(badges: Map<string, TaskBadge[]>): Pipeline {
  return (rows, state, ctx) => {
    const sorted = applySorts(applyFilters(rows, state.filterGroup, ctx), state.sorts, ctx)
    const overdue = sorted.filter((r) => badges.get(r.summary.path)?.includes('overdue'))
    const rest = sorted.filter((r) => !badges.get(r.summary.path)?.includes('overdue'))
    const g = groupRows(rest, state.groupBy, state.viewDefinition.groupByConfig, ctx)
    if (overdue.length === 0) return { rows: sorted, groups: g.groups, hidden: g.hidden }
    const restGroups = state.groupBy ? g.groups : rest.length ? [{ id: 'today', label: SECTIONS_TEXT.todayGroup, rows: rest }] : []
    return {
      rows: [...overdue, ...rest],
      groups: [{ id: 'overdue', label: SECTIONS_TEXT.overdue(overdue.length), rows: overdue }, ...restGroups],
      hidden: g.hidden,
    }
  }
}

/** `{date}` moved to `to`, keeping its resolution, local time of day and range length. */
export function moveDate(v: DateValue | null | undefined, to: Day): DateValue {
  if (!v?.start || v.resolution === 'day' || /^\d{4}-\d{2}-\d{2}$/.test(v.start)) {
    const from = v?.start?.slice(0, 10)
    const fromDate = from ? parseYmd(from) : null
    const toDate = parseYmd(to)
    const delta = fromDate && toDate ? Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) : 0
    const end = v?.end && parseYmd(v.end.slice(0, 10)) ? addDays(v.end.slice(0, 10), delta) : null
    return end ? { start: to, end, resolution: 'day' } : { start: to, resolution: 'day' }
  }
  const start = new Date(v.start)
  const target = parseYmd(to)
  if (Number.isNaN(start.getTime()) || !target) return { start: to, resolution: 'day' }
  const fromDay = parseYmd(ymd(start))!
  const delta = Math.round((target.getTime() - fromDay.getTime()) / 86_400_000)
  const shift = (d: Date) => {
    const n = new Date(d)
    n.setDate(n.getDate() + delta) // local wall clock: 09:00 stays 09:00 across DST
    return n.toISOString()
  }
  const end = v.end ? new Date(v.end) : null
  return end && !Number.isNaN(end.getTime())
    ? { start: shift(start), end: shift(end), resolution: 'time' }
    : { start: shift(start), resolution: 'time' }
}

const SECTION_LAYOUTS: readonly Layout[] = ['list', 'grid', 'wall', 'embed']

const viewOf = (layout: Layout): ViewState => ({
  viewDefinition: { dataViewLayout: layout },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

type ViewKey = 'tasksView' | 'createdView' | 'updatedView' | 'datedView'

function useSectionView(daily: CalendarDaily, key: ViewKey, layout: Layout): [ViewState, (v: ViewState) => void] {
  const saved = daily[key]
  const initial = useMemo(() => saved ?? viewOf(layout), [saved, layout])
  const [state, update] = useViewState(initial, async (next) => saveCalendarDaily({ [key]: next }))
  return [state, (v) => update(() => v)]
}

function SectionShell({
  label,
  testId,
  hideKey,
  collapsed,
  children,
}: {
  label: string
  testId: string
  hideKey: keyof CalendarDaily
  collapsed: boolean
  children: (heading: ReactNode) => ReactNode
}) {
  const heading = (
    <SectionHeading label={label} collapsed={collapsed} onToggle={() => void saveCalendarDaily({ [hideKey]: !collapsed })} />
  )
  return (
    <section data-testid={testId} aria-label={label} className="flex flex-col gap-2">
      {collapsed ? <div className="flex h-10 items-center">{heading}</div> : children(heading)}
    </section>
  )
}

export interface DaySectionsProps {
  day: Day
  /** The viewer's local day. */
  today: Day
  calendarDay: CalendarDay | null
  rows: CalendarRows
  filter?: DayFilter
  /** The range changed here (a note created, tasks moved): the owner reloads. */
  onChanged?(): void
  /** Show the Daily note section (the Day view; Three days shows its own slot). */
  showDailyNote?: boolean
}

export function DaySections({ day, today, calendarDay, rows, filter = 'all', onChanged, showDailyNote = true }: DaySectionsProps) {
  const types = useLinkIndex((s) => s.types)
  const typesById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])) as Record<string, TypeDef>, [types])
  const daily = useCalendarDaily()
  const [toast, setToast] = useState<string | null>(null)
  const [tasksView, setTasksView] = useSectionView(daily, 'tasksView', 'list')
  const [createdView, setCreatedView] = useSectionView(daily, 'createdView', 'wall')
  const [updatedView, setUpdatedView] = useSectionView(daily, 'updatedView', 'wall')
  const [datedView, setDatedView] = useSectionView(daily, 'datedView', 'list')

  useEffect(() => {
    void ensureLinkIndex()
  }, [])

  const badges = useMemo(() => taskBadges(calendarDay), [calendarDay])
  const pipeline = useMemo(() => overduePipeline(badges), [badges])
  const pick = useCallback(
    (paths: Iterable<string>) => {
      const out: Row[] = []
      for (const p of new Set(paths)) {
        const r = rows.byPath.get(p)
        if (r) out.push(r)
      }
      return out
    },
    [rows.byPath],
  )
  const taskRows = useMemo(() => pick(badges.keys()), [pick, badges])
  const datedRows = useMemo(() => pick((calendarDay?.dated ?? []).map((d) => d.path)), [pick, calendarDay])
  const createdRows = useMemo(() => pick(calendarDay?.created ?? []), [pick, calendarDay])
  const updatedRows = useMemo(() => pick(calendarDay?.updated ?? []), [pick, calendarDay])

  const onResult = useCallback(
    (outcome: TaskOutcome) => {
      if (outcome.row) rows.patchRow(outcome.row.summary.path, outcome.row)
      setToast(completionToast(outcome))
    },
    [rows],
  )
  const rowExtras = useCallback(
    (row: Row) => taskRowExtras(row, typesById[row.summary.type], { badges: badges.get(row.summary.path), onResult }),
    [typesById, badges, onResult],
  )

  // Stats: each task path once; done from its entries.
  const doneByPath = new Map<string, boolean>()
  for (const t of calendarDay?.tasks ?? []) doneByPath.set(t.path, (doneByPath.get(t.path) ?? false) || t.done)
  const doneCount = [...doneByPath.values()].filter(Boolean).length
  const openCount = doneByPath.size - doneCount
  const stats =
    doneByPath.size === 0
      ? null
      : day === today
        ? SECTIONS_TEXT.statsToday(openCount, doneCount)
        : day < today
          ? SECTIONS_TEXT.statsPast(doneCount)
          : SECTIONS_TEXT.statsFuture(openCount)

  const moveAll = async (to: Day) => {
    setToast(null)
    const movable = [...badges.entries()]
      .filter(([p, kinds]) => !doneByPath.get(p) && (kinds.includes('date') || kinds.includes('overdue')))
      .map(([p]) => rows.byPath.get(p))
      .filter((r): r is Row => !!r)
    let conflicts = 0
    let failed: string | null = null
    for (const r of movable) {
      const current = r.values.date as DateValue | null | undefined
      try {
        await api.updateProperties(r.summary.path, { date: moveDate(current, to) }, r.version)
      } catch (e) {
        if (e instanceof ConflictError) conflicts += 1
        else failed = e instanceof Error ? e.message : String(e)
      }
    }
    if (conflicts) setToast(SECTIONS_TEXT.moveConflict(conflicts))
    else if (failed) setToast(failed)
    onChanged?.()
  }

  const createTask = async () => {
    try {
      await createAndOpen('task', { values: { date: { start: day, resolution: 'day' } } })
      onChanged?.()
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    }
  }

  const show = (f: DayFilter) => filter === 'all' || filter === f
  const tasksEmpty = (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      <p className="text-[15px] font-medium text-fg">{day === today ? SECTIONS_TEXT.noTasksToday : SECTIONS_TEXT.noTasksOnDay}</p>
      <p className="text-[14px] text-fg-muted">{SECTIONS_TEXT.emptyHint}</p>
    </div>
  )
  const common = { types, layouts: SECTION_LAYOUTS, compact: true, embedded: true, patchRow: rows.patchRow, loading: rows.loading }

  return (
    <div data-testid="day-sections" className="flex flex-col gap-8">
      {showDailyNote && show('dailyNote') && (
        <DailyNoteSlot
          day={day}
          note={calendarDay?.dailyNote ?? null}
          heading
          onChanged={onChanged}
          collapsed={!!daily.hideDailyNote}
          onToggleCollapsed={() => void saveCalendarDaily({ hideDailyNote: !daily.hideDailyNote })}
        />
      )}
      {show('tasks') && (
        <SectionShell label={SECTIONS_TEXT.tasks} testId="section-tasks" hideKey="hideTasks" collapsed={!!daily.hideTasks}>
          {(heading) => (
            <>
              <DataView
                {...common}
                rows={taskRows}
                scope={{ typeIds: ['task'] }}
                state={tasksView}
                onState={setTasksView}
                pipeline={pipeline}
                rowExtras={rowExtras}
                emptyState={tasksEmpty}
                heading={
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      {heading}
                      {stats && (
                        <span data-testid="task-stats" className="text-[14px] text-fg-muted">
                          {stats}
                        </span>
                      )}
                    </div>
                    <TasksAddMenu onCreate={() => void createTask()} onMove={(to) => void moveAll(to)} />
                  </div>
                }
              />
              {toast && (
                <p role="status" className="text-[13px] text-fg-muted">
                  {toast}
                </p>
              )}
            </>
          )}
        </SectionShell>
      )}
      {show('dated') && datedRows.length > 0 && (
        <SectionShell label={SECTIONS_TEXT.dated} testId="section-dated" hideKey="hideDated" collapsed={!!daily.hideDated}>
          {(heading) => <DataView {...common} rows={datedRows} state={datedView} onState={setDatedView} heading={heading} />}
        </SectionShell>
      )}
      {show('created') && (
        <SectionShell
          label={createdLabel(day, today)}
          testId="section-created"
          hideKey="hideCreatedOnDay"
          collapsed={!!daily.hideCreatedOnDay}
        >
          {(heading) => <DataView {...common} rows={createdRows} state={createdView} onState={setCreatedView} heading={heading} />}
        </SectionShell>
      )}
      {show('updated') && updatedRows.length > 0 && (
        <SectionShell label={updatedLabel(day, today)} testId="section-updated" hideKey="hideUpdated" collapsed={!!daily.hideUpdated}>
          {(heading) => <DataView {...common} rows={updatedRows} state={updatedView} onState={setUpdatedView} heading={heading} />}
        </SectionShell>
      )}
    </div>
  )
}

/** The Tasks section's `+`: "Create task" and "Move all open tasks to" Today / Tomorrow / Pick a date. */
function TasksAddMenu({ onCreate, onMove }: { onCreate(): void; onMove(to: Day): void }) {
  const [picked, setPicked] = useState('')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={SECTIONS_TEXT.add}
          title={SECTIONS_TEXT.add}
          className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-plus" size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 border-line bg-raised">
        <DropdownMenuItem onSelect={onCreate}>
          <Icon name="ph-plus" size={14} />
          {SECTIONS_TEXT.createTask}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="ph-arrow-bend-up-right" size={14} />
            {SECTIONS_TEXT.moveAll}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="border-line bg-raised">
            <DropdownMenuItem onSelect={() => onMove(todayYmd())}>{SECTIONS_TEXT.today}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(addDays(todayYmd(), 1))}>{SECTIONS_TEXT.tomorrow}</DropdownMenuItem>
            <div className="flex flex-col gap-1 px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
              <label className="text-[12px] text-fg-muted" htmlFor="move-all-date">
                {SECTIONS_TEXT.pickDate}
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="move-all-date"
                  type="date"
                  aria-label={SECTIONS_TEXT.pickDate}
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-app px-1.5 text-[13px] text-fg"
                />
                <DropdownMenuItem disabled={!parseYmd(picked)} onSelect={() => parseYmd(picked) && onMove(picked)}>
                  Move
                </DropdownMenuItem>
              </div>
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
