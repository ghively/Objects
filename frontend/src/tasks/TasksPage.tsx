// The Tasks dashboard's list views (Gene's redesign, phase 2: the old Tasks page — its header and
// section tabs — is retired; the dashboard in `work/` is the one Tasks page). Each task section
// (`taskSections.ts`) is a `DataView` over the section's Task rows, with the quick add on top; the
// section's view starts from its preset and the user's changes are saved per section in
// `ui.tasks.views` (debounced, with M3's 409 refetch and re-apply). Status writes (checkbox, kanban
// drop) reload the row, patch it in and show what happened. The rows come from the page's one feed
// (`useTaskRows`).
//
// M32: the plain Tasks page is back as its own page (`TasksPage`, at the end of this file; the
// dashboard is the optional Work page). The contract ships it as a stub over these lists.
import { useCallback, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { Row, TaskSectionKey, TasksUi, TypeDef, UpdateResult, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { createAndOpen } from '@/create/createAndOpen'
import { useZonedToday } from '@/lib/zonedShell'
import { useLinkIndex } from '@/links/linkIndex'
import { enqueueUiSave, reloadUi, usePinned, useUiStore } from '@/shell/usePinned'
import { useDefinitions } from '@/types/useDefinitions'
import type { CustomizePage } from '@/views/CustomizeMenu'
import { DataView } from '@/views/DataView'
import { matchingValues } from '@/views/matching'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { useViewState } from '@/views/useViewState'
import { QuickAddTask } from './QuickAddTask'
import { completionToast, type TaskOutcome } from './taskActions'
import { taskRowExtras } from './taskRowExtras'
import { DEFAULT_TASK_SECTION, TASK_SECTIONS, isTaskSectionKey, sectionRows, todayOpenCount } from './taskSections'
import { useTaskRows, useTaskRowsFeed } from './useTaskRows'

export { findTaskType } from './useTaskRows'

export const TASKS_TEXT = {
  heading: 'Tasks',
  createTask: 'Create task', // our string
  resetView: 'Reset view', // our string
  resetHint: 'Go back to the section’s original view.', // our string
}

// ---- ui.tasks: saved in order with the latest revision ------------------------------------

const EMPTY_VIEWS: TasksUi['views'] = {}
const EMPTY_TASKS: TasksUi = { activeTab: DEFAULT_TASK_SECTION, views: EMPTY_VIEWS }

function tasksOf(ui: { tasks?: unknown } | null | undefined): TasksUi {
  const t = ui?.tasks as Partial<TasksUi> | undefined
  if (!t || typeof t !== 'object') return EMPTY_TASKS
  return {
    activeTab: isTaskSectionKey(t.activeTab) ? t.activeTab : DEFAULT_TASK_SECTION,
    views: t.views && typeof t.views === 'object' ? t.views : EMPTY_VIEWS,
  }
}

/** Write `ui.tasks = edit(current)` with the stored revision; a 409 is thrown to the caller. */
function saveTasks(edit: (cur: TasksUi) => TasksUi): Promise<void> {
  // In the one ui.json save queue, so each save sends the revision the previous one returned.
  return enqueueUiSave(async () => {
    const { ui, revision } = useUiStore.getState()
    const next = edit(tasksOf(ui))
    const res = await api.patchUi({ tasks: next }, { baseRevision: revision })
    const cur = useUiStore.getState().ui
    useUiStore.setState({ ui: { ...cur, tasks: res?.ui?.tasks ?? next }, revision: res?.revision ?? revision })
  })
}

// ---- one section ---------------------------------------------------------------------------

function SectionView({
  sectionKey,
  rows,
  loading,
  types,
  taskType,
  patchRow,
  onToast,
}: {
  sectionKey: TaskSectionKey
  rows: Row[]
  loading: boolean
  types: TypeDef[]
  taskType: TypeDef | undefined
  patchRow(path: string, row: Row): void
  onToast(text: string | null): void
}) {
  const section = TASK_SECTIONS[sectionKey]
  const { collections } = useDefinitions()
  const saved = useUiStore((s) => tasksOf(s.ui).views[sectionKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one preset per mount of the section
  const preset = useMemo(() => section.preset(new Date()), [sectionKey])
  const initial = saved ?? preset

  const save = useCallback(
    (next: ViewState) => saveTasks((t) => ({ ...t, views: { ...t.views, [sectionKey]: next } })),
    [sectionKey],
  )
  const refetch = useCallback(async (): Promise<ViewState> => {
    await reloadUi()
    return tasksOf(useUiStore.getState().ui).views[sectionKey] ?? section.preset(new Date())
  }, [sectionKey, section])
  const [state, update] = useViewState<ViewState>(initial, save, refetch)

  // `today` re-renders the sections when the day changes (midnight).
  const today = useZonedToday()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` stands for `new Date()`'s day
  const shown = useMemo(() => sectionRows(sectionKey, rows, taskType, new Date()), [sectionKey, rows, taskType, today])
  const typesById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types])
  const scope = useMemo(() => (taskType ? { typeIds: [taskType.id] } : undefined), [taskType])

  const onResult = useCallback(
    (outcome: TaskOutcome) => {
      if (outcome.row) patchRow(outcome.row.summary.path, outcome.row)
      onToast(completionToast(outcome))
    },
    [patchRow, onToast],
  )
  const onWritten = useCallback(
    (row: Row, result: UpdateResult) => onToast(completionToast({ result: result.task ?? undefined, row, conflict: false })),
    [onToast],
  )

  const customizePages: CustomizePage[] = [
    {
      key: 'reset',
      label: TASKS_TEXT.resetView,
      icon: 'ph-arrow-counter-clockwise',
      body: (
        <div className="flex flex-col gap-2 px-2 py-1.5">
          <p className="text-[13px] text-fg-muted">{TASKS_TEXT.resetHint}</p>
          <button
            type="button"
            onClick={() => update(() => section.preset(new Date()))}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-[14px] hover:bg-hover"
          >
            <Icon name="ph-arrow-counter-clockwise" size={14} />
            {TASKS_TEXT.resetView}
          </button>
        </div>
      ),
    },
  ]

  return (
    <DataView
      rows={shown}
      types={types}
      collections={collections}
      scope={scope}
      loading={loading}
      state={state}
      onState={(next) => update(() => next)}
      layouts={FULL_VIEW_LAYOUTS}
      patchRow={patchRow}
      rowExtras={(row) => taskRowExtras(row, typesById[row.summary.type], { onResult })}
      onWritten={onWritten}
      customizePages={customizePages}
      allowCreate={!!taskType}
      onCreate={(values, typeId) =>
        void createAndOpen(typeId, { values }).catch((e: unknown) => console.warn('Could not create a task:', e))
      }
      heading={<p className="truncate text-[14px] text-fg-muted">{section.description}</p>}
    />
  )
}

// ---- one section: a list view of the Tasks dashboard -------------------------------------

/**
 * One task section as a view of the Tasks dashboard (Inbox, Today's list, Scheduled, ...): the
 * quick add (a new task gets the values the section's filter implies, so it lands in this list),
 * the status line and the section's `DataView`. The rows are the page's (`useTaskRowsFeed`).
 */
export function TaskSectionPanel({ sectionKey }: { sectionKey: TaskSectionKey }) {
  usePinned() // loads `ui.json`
  const types = useLinkIndex((s) => s.types)
  const { collections } = useDefinitions()
  const { rows, loading, patchRow, taskType } = useTaskRows()
  const [toast, setToast] = useState<string | null>(null)
  const typeList = types.length > 0 ? types : taskType ? [taskType] : []
  const quickValues = () => {
    if (!taskType) return {}
    const state = tasksOf(useUiStore.getState().ui).views[sectionKey] ?? TASK_SECTIONS[sectionKey].preset(new Date())
    return matchingValues(state.filterGroup, typeList, taskType.id, collections)
  }
  return (
    <div data-task-section={sectionKey} className="flex flex-col gap-2">
      <QuickAddTask taskTypeId={taskType?.id} values={quickValues} />
      {toast && (
        <p role="status" className="text-[13px] text-fg-muted">
          {toast}
        </p>
      )}
      <SectionView
        key={sectionKey}
        sectionKey={sectionKey}
        rows={rows}
        loading={loading}
        types={typeList}
        taskType={taskType}
        patchRow={patchRow}
        onToast={setToast}
      />
    </div>
  )
}

/** How many Task rows a section holds now (the dashboard's count badges). */
export function sectionCount(sectionKey: TaskSectionKey, now: Date = new Date()): number {
  const { rows, taskType } = useTaskRows.getState()
  return sectionRows(sectionKey, rows, taskType, now).length
}

/** Today's open tasks (the Today badge; decision T1: the same rule as the Calendar Day view's list). */
export function todayTaskCount(now: Date = new Date()): number {
  const { rows, taskType } = useTaskRows.getState()
  return todayOpenCount(rows, taskType, now)
}

// ---- the Tasks page (M32) ------------------------------------------------------------------

export type TasksTabKey = 'today' | 'upcoming' | 'inbox' | 'all' | 'done'

/**
 * M32: the plain Tasks page's tabs, in order, each over one of the task sections. The page opens
 * on the first (Today).
 */
export const TASKS_PAGE_TABS: readonly { key: TasksTabKey; label: string; section: TaskSectionKey }[] = [
  { key: 'today', label: 'Today', section: 'today' },
  { key: 'upcoming', label: 'Upcoming', section: 'scheduled' },
  { key: 'inbox', label: 'Inbox', section: 'inbox' },
  { key: 'all', label: 'All', section: 'all' },
  { key: 'done', label: 'Done', section: 'completed' },
]

/**
 * M32 contract stub of the plain Tasks page (the `tasks` target, and the `work` target while Work
 * is off): the heading and the five tabs, each showing the existing list of its section
 * (`TaskSectionPanel`). It mounts the page's one Task rows feed. Lane C builds the real page.
 */
export function TasksPage() {
  useTaskRowsFeed()
  const [tab, setTab] = useState<TasksTabKey>(TASKS_PAGE_TABS[0].key)
  const current = TASKS_PAGE_TABS.find((t) => t.key === tab) ?? TASKS_PAGE_TABS[0]
  return (
    <div data-tasks-page="" className="h-full min-h-0 overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 pt-5 pb-16">
        <header className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover-2">
            <Icon name="ph-check-circle" size={20} />
          </span>
          <h1 className="dataview-heading min-w-0 shrink-0 text-[20px] font-bold md:text-[22px]">{TASKS_TEXT.heading}</h1>
        </header>
        <div role="tablist" aria-label={TASKS_TEXT.heading} className="flex flex-wrap items-center gap-1">
          {TASKS_PAGE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tasks-tab-${t.key}`}
              aria-selected={t.key === current.key}
              aria-controls="tasks-panel"
              onClick={() => setTab(t.key)}
              className={
                t.key === current.key
                  ? 'h-8 rounded-lg bg-hover px-3 text-[14px] font-medium text-fg'
                  : 'h-8 rounded-lg px-3 text-[14px] text-fg-muted hover:text-fg'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="tasks-panel" aria-labelledby={`tasks-tab-${current.key}`}>
          <TaskSectionPanel key={current.section} sectionKey={current.section} />
        </div>
      </div>
    </div>
  )
}
