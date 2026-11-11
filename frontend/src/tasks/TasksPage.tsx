// M32: the plain Tasks page (`TasksPage`, at the end of this file), and the task lists it shares
// with the optional Work page (the dashboard in `work/`).
//
// The page: the header ("Tasks", "Search tasks", "New task"), "Add a task" (the quick add, which
// reads date words), the tabs Today, Upcoming, Inbox, All and Done (`taskTabs.ts`, drawn by
// `TaskList`) and a "More" menu with the other plain lists (Status, Deadline, Recurring,
// Reminders, Tags, Context). It opens on Today and remembers the last list per space in the
// browser (`tasksTab.ts`). Opening it, or moving between its tabs, writes no file.
//
// The task lists (`TaskSectionPanel`; the "More" lists here, every list view of the Work page):
// each task section (`taskSections.ts`) is a `DataView` over the section's Task rows, with the
// quick add on top; the section's view starts from its preset and the user's changes are saved per
// section in `ui.tasks.views` (debounced, with M3's 409 refetch and re-apply). Status writes
// (checkbox, kanban drop) reload the row, patch it in and show what happened. The rows come from
// the page's one feed (`useTaskRows`).
import { useCallback, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { Row, TaskSectionKey, TasksUi, TypeDef, UpdateResult, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { createAndOpen } from '@/create/createAndOpen'
import { cn } from '@/lib/utils'
import { TASKS } from '@/lib/words'
import { useZonedToday } from '@/lib/zonedShell'
import { useLinkIndex } from '@/links/linkIndex'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { enqueueUiSave, reloadUi, usePinned, useUiStore } from '@/shell/usePinned'
import { useDefinitions } from '@/types/useDefinitions'
import type { CustomizePage } from '@/views/CustomizeMenu'
import { DataView } from '@/views/DataView'
import { matchingValues } from '@/views/matching'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { useViewState } from '@/views/useViewState'
import { QuickAddTask } from './QuickAddTask'
import { TaskList } from './TaskList'
import { completionToast, type TaskOutcome } from './taskActions'
import { taskRowExtras } from './taskRowExtras'
import { DEFAULT_TASK_SECTION, TASK_SECTIONS, isTaskSectionKey, sectionRows, todayOpenCount } from './taskSections'
import { TASKS_MORE_LISTS, TASKS_PAGE_TABS, TASK_TABS_TEXT, searchTasks, tabGroups } from './taskTabs'
import { DEFAULT_TASKS_LIST, TASKS_PAGE_LISTS, readTasksTab, writeTasksTab } from './tasksTab'
import { useTaskRows, useTaskRowsFeed } from './useTaskRows'

export { findTaskType } from './useTaskRows'
export { TASKS_PAGE_TABS, type TasksTabKey } from './taskTabs'

export const TASKS_TEXT = {
  heading: TASKS,
  /** M32 (glossary): the Tasks page's header. */
  searchTasks: 'Search tasks',
  newTask: 'New task',
  /** The menu with the other plain lists (our string). */
  more: 'More',
  /** The Work page's header button keeps this wording. */
  createTask: 'Create task', // our string
  resetView: 'Reset view', // our string
  resetHint: 'Go back to the section’s original view.', // our string
}

/** The Task type's id when the space has none yet: the server makes the type with the first task. */
const TASK_TYPE_ID = 'task'

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
  search,
}: {
  sectionKey: TaskSectionKey
  rows: Row[]
  loading: boolean
  types: TypeDef[]
  taskType: TypeDef | undefined
  patchRow(path: string, row: Row): void
  onToast(text: string | null): void
  /** M32: only the tasks whose title holds this text ("Search tasks"). */
  search: string
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
  const shown = useMemo(
    () => searchTasks(sectionRows(sectionKey, rows, taskType, new Date()), search),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` stands for `new Date()`'s day
    [sectionKey, rows, taskType, today, search],
  )
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

// ---- one section: a list view of the Work page, a "More" list of the Tasks page -------------

/**
 * One task section as a list (the Work page's Inbox, Today's list, Scheduled, ...; the Tasks
 * page's "More" lists): the quick add (a new task gets the values the section's filter implies, so
 * it lands in this list), the status line and the section's `DataView`. The rows are the page's
 * (`useTaskRowsFeed`). The Tasks page has its own quick add on top and its search (`quickAdd`
 * false, `search`).
 */
export function TaskSectionPanel({
  sectionKey,
  quickAdd = true,
  search = '',
}: {
  sectionKey: TaskSectionKey
  quickAdd?: boolean
  search?: string
}) {
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
      {quickAdd && <QuickAddTask taskTypeId={taskType?.id} values={quickValues} />}
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
        search={search}
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

const TAB = 'h-8 rounded-lg px-3 text-[14px]'
const TAB_ON = 'bg-hover font-medium text-fg'
const TAB_OFF = 'text-fg-muted hover:text-fg'

/**
 * The Tasks page list a Work view stands for while Work is off (a `{kind: 'work', view}` target
 * from a restored tab or the Calendar's link to today's tasks): Today, or the task list behind a
 * `list-<section>` view. Undefined for a view the Tasks page has no list for (it opens as usual).
 */
export function tasksListForWorkView(view: string | undefined): TaskSectionKey | undefined {
  const key = view?.startsWith('list-') ? view.slice('list-'.length) : view
  return TASKS_PAGE_LISTS.find((k) => k === key)
}

/**
 * M32: the plain Tasks page (the `tasks` target, and the `work` target while Work is off). See the
 * top of this file. It mounts the page's one Task rows feed; nothing of the Work page runs here.
 * `list` opens it on that list (one of the page's: a tab's section or a "More" list) instead of
 * the remembered one, without changing what is remembered.
 */
export function TasksPage({ list }: { list?: TaskSectionKey } = {}) {
  useTaskRowsFeed()
  const { rows, loading, patchRow, taskType } = useTaskRows()
  const root = useSpaceInfo((s) => s.space?.root ?? null)
  const asked = TASKS_PAGE_LISTS.find((k) => k === list) ?? null
  /** The list picked on this visit; before a pick, the one asked for, else the one remembered for the space, else Today. */
  const [picked, setPicked] = useState<{ root: string | null; asked: TaskSectionKey | null; list: TaskSectionKey } | null>(null)
  const mine = picked && picked.root === root && picked.asked === asked ? picked.list : null
  const active: TaskSectionKey = mine ?? asked ?? readTasksTab(root) ?? DEFAULT_TASKS_LIST
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const today = useZonedToday()

  const tab = TASKS_PAGE_TABS.find((t) => t.section === active)
  const found = useMemo(() => searchTasks(rows, search), [rows, search])
  const groups = useMemo(() => (tab ? tabGroups(tab.key, found, taskType, today) : []), [tab, found, taskType, today])
  const taskTypeId = taskType?.id ?? TASK_TYPE_ID

  const show = (list: TaskSectionKey) => {
    setToast(null)
    setPicked({ root, asked, list })
    writeTasksTab(root, list)
  }
  const onResult = useCallback(
    (outcome: TaskOutcome) => {
      if (outcome.row) patchRow(outcome.row.summary.path, outcome.row)
      setToast(completionToast(outcome))
    },
    [patchRow],
  )

  return (
    <div data-tasks-page="" className="h-full min-h-0 overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 pt-5 pb-16">
        <header className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover-2">
            <Icon name="ph-check-circle" size={20} />
          </span>
          <h1 className="dataview-heading min-w-0 shrink-0 text-[20px] font-bold md:text-[22px]">{TASKS_TEXT.heading}</h1>
          <div className="ml-auto flex min-w-0 shrink items-center">
            <input
              type="search"
              aria-label={TASKS_TEXT.searchTasks}
              placeholder={TASKS_TEXT.searchTasks}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && search) {
                  e.preventDefault()
                  e.stopPropagation()
                  setSearch('')
                }
              }}
              className="h-8 w-56 min-w-0 rounded-lg border border-line bg-raised px-2.5 text-[14px] text-fg outline-none placeholder:text-fg-muted focus:border-fg-muted"
            />
          </div>
          <button
            type="button"
            onClick={(e) =>
              void createAndOpen(taskTypeId, {}, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }).catch(
                (err: unknown) => setToast(err instanceof Error && err.message ? err.message : String(err)),
              )
            }
            className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 text-[14px] font-medium hover:bg-hover"
          >
            <Icon name="ph-plus" size={14} />
            {TASKS_TEXT.newTask}
          </button>
        </header>
        <QuickAddTask taskTypeId={taskTypeId} />
        <div className="flex flex-wrap items-center gap-1">
          {/* A tab list's keys: one stop for Tab (the selected tab, or the first while a "More"
              list is shown); Left and Right move to the next tab and show its list, Home and End
              go to the first and the last. */}
          <div
            role="tablist"
            aria-label={TASKS_TEXT.heading}
            className="flex flex-wrap items-center gap-1"
            onKeyDown={(e) => {
              if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
              const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')]
              const at = tabs.indexOf(document.activeElement as HTMLElement)
              const n = tabs.length
              const to =
                e.key === 'ArrowRight' ? (at + 1) % n : e.key === 'ArrowLeft' ? (at - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
              if (at < 0 || to < 0) return
              e.preventDefault()
              tabs[to].focus()
              show(TASKS_PAGE_TABS[to].section)
            }}
          >
            {TASKS_PAGE_TABS.map((t, i) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`tasks-tab-${t.key}`}
                aria-selected={t.section === active}
                aria-controls="tasks-panel"
                tabIndex={(tab ? t.section === active : i === 0) ? 0 : -1}
                onClick={() => show(t.section)}
                className={cn(TAB, t.section === active ? TAB_ON : TAB_OFF)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                id="tasks-more"
                aria-label={TASKS_TEXT.more}
                className={cn(TAB, 'flex items-center gap-1', tab ? TAB_OFF : TAB_ON)}
              >
                {tab ? TASKS_TEXT.more : TASK_SECTIONS[active].title}
                <Icon name="ph-caret-down" size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-line bg-raised">
              <DropdownMenuRadioGroup value={tab ? '' : active} onValueChange={(v) => isTaskSectionKey(v) && show(v)}>
                {TASKS_MORE_LISTS.map((key) => (
                  <DropdownMenuRadioItem key={key} value={key} title={TASK_SECTIONS[key].description}>
                    {TASK_SECTIONS[key].title}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {toast && (
          <p role="status" className="text-[13px] text-fg-muted">
            {toast}
          </p>
        )}
        <div role="tabpanel" id="tasks-panel" aria-labelledby={tab ? `tasks-tab-${tab.key}` : 'tasks-more'}>
          {tab ? (
            loading && rows.length === 0 ? null : (
              <TaskList
                key={tab.key}
                groups={groups}
                type={taskType}
                onResult={onResult}
                empty={search.trim() && rows.length > 0 ? TASK_TABS_TEXT.noMatch : TASK_TABS_TEXT.empty[tab.key]}
              />
            )
          ) : (
            <TaskSectionPanel key={active} sectionKey={active} quickAdd={false} search={search} />
          )}
        </div>
      </div>
    </div>
  )
}
