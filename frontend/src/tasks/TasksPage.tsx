// The Tasks page: "Tasks" heading, "Create task", the quick add, and one tab per section
// (`taskSections.ts`). Each tab is a `DataView` over the section's Task rows; the section's view
// starts from its preset and the user's changes are saved per section in `ui.tasks.views`
// (debounced, with M3's 409 refetch and re-apply); the active tab is `ui.tasks.activeTab`.
// Status writes (checkbox, kanban drop) reload the row, patch it in and show what happened.
import { useCallback, useMemo, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Row, TaskSectionKey, TasksUi, TypeDef, UpdateResult, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { createAndOpen } from '@/create/createAndOpen'
import { cn } from '@/lib/utils'
import { useZonedToday } from '@/lib/zonedShell'
import { useLinkIndex } from '@/links/linkIndex'
import { enqueueUiSave, reloadUi, usePinned, useUiStore } from '@/shell/usePinned'
import { useDefinitions } from '@/types/useDefinitions'
import type { CustomizePage } from '@/views/CustomizeMenu'
import { DataView } from '@/views/DataView'
import { matchingValues } from '@/views/matching'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { useRows } from '@/views/useRows'
import { useViewState } from '@/views/useViewState'
import { QuickAddTask } from './QuickAddTask'
import { completionToast, type TaskOutcome } from './taskActions'
import { taskRowExtras } from './taskRowExtras'
import { DEFAULT_TASK_SECTION, TASK_SECTIONS, TASK_SECTION_KEYS, isTaskSectionKey, sectionRows } from './taskSections'

export const TASKS_TEXT = {
  heading: 'Tasks',
  createTask: 'Create task', // our string: the reference's Tasks page has no header button
  resetView: 'Reset view', // our string
  resetHint: 'Go back to the section’s original view.', // our string
}

/** The basic Task type among `types` (by flag and name, as the server infers it). */
export function findTaskType(types: TypeDef[]): TypeDef | undefined {
  return types.find((t) => t.basic && t.name.toLowerCase() === 'task') ?? types.find((t) => t.id === 'task')
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

/** The active tab: optimistic, saved; on a 409 the fresh ui is fetched and the tab saved again once. */
async function saveActiveTab(key: TaskSectionKey): Promise<void> {
  const cur = useUiStore.getState().ui
  useUiStore.setState({ ui: { ...cur, tasks: { ...tasksOf(cur), activeTab: key } } })
  const edit = (t: TasksUi): TasksUi => ({ ...t, activeTab: key })
  try {
    await saveTasks(edit)
  } catch (e) {
    if (!(e instanceof ConflictError)) {
      console.warn('Could not save the Tasks tab:', e)
      return
    }
    try {
      await reloadUi()
      await saveTasks(edit)
    } catch (e2) {
      console.warn('Could not save the Tasks tab:', e2)
    }
  }
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

// ---- the page ------------------------------------------------------------------------------

export function TasksPage() {
  usePinned() // loads `ui.json`
  const types = useLinkIndex((s) => s.types)
  const { collections } = useDefinitions()
  const taskType = useMemo(() => findTaskType(types), [types])
  const active = useUiStore((s) => tasksOf(s.ui).activeTab)
  const [toast, setToast] = useState<string | null>(null)

  const scope = useMemo(() => ({ typeIds: [taskType?.id ?? 'task'] }), [taskType])
  const { rows, loading, patchRow } = useRows(scope)
  const quickValues = () => {
    if (!taskType) return {}
    const state = tasksOf(useUiStore.getState().ui).views[active] ?? TASK_SECTIONS[active].preset(new Date())
    return matchingValues(state.filterGroup, types.length > 0 ? types : [taskType], taskType.id, collections)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-5 pb-16">
      <header className="flex flex-col gap-3 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover-2">
            <Icon name="ph-check-circle" size={20} />
          </span>
          <h1 className="dataview-heading min-w-0 flex-1 text-[20px] font-bold md:text-[22px]">{TASKS_TEXT.heading}</h1>
          <button
            type="button"
            disabled={!taskType}
            onClick={(e) =>
              taskType &&
              void createAndOpen(taskType.id, {}, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }).catch(
                (err: unknown) => console.warn('Could not create a task:', err),
              )
            }
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[14px] font-medium hover:bg-hover disabled:opacity-50"
          >
            <Icon name="ph-plus" size={14} />
            {TASKS_TEXT.createTask}
          </button>
        </div>
        <QuickAddTask taskTypeId={taskType?.id} values={quickValues} />
      </header>
      <nav role="tablist" aria-label="Task sections" className="flex flex-wrap items-center gap-1 pb-3">
        {TASK_SECTION_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            title={TASK_SECTIONS[key].description}
            onClick={() => {
              setToast(null)
              if (key !== active) void saveActiveTab(key)
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium',
              active === key ? 'bg-hover-2 text-fg' : 'text-fg-muted hover:bg-hover',
            )}
          >
            <Icon name={TASK_SECTIONS[key].icon} size={14} />
            {TASK_SECTIONS[key].title}
          </button>
        ))}
      </nav>
      {toast && (
        <p role="status" className="pb-2 text-[13px] text-fg-muted">
          {toast}
        </p>
      )}
      <SectionView
        key={active}
        sectionKey={active}
        rows={rows}
        loading={loading}
        types={types.length > 0 ? types : taskType ? [taskType] : []}
        taskType={taskType}
        patchRow={patchRow}
        onToast={setToast}
      />
    </div>
  )
}
