import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, UiState, UpdateResult } from '@/api/types'

let dragEnd: ((e: unknown) => void) | undefined
vi.mock('@dnd-kit/core', async (orig) => {
  const real = await orig<typeof import('@dnd-kit/core')>()
  return {
    ...real,
    DndContext: (p: { onDragEnd?: (e: unknown) => void } & Record<string, unknown>) => {
      dragEnd = p.onDragEnd
      return <real.DndContext {...(p as object)} />
    },
  }
})
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { resetPinned } from '@/shell/usePinned'
import { useDefs } from '@/types/useDefinitions'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { TASK_TYPE, taskRow } from './taskFixtures'
import type { TaskSectionKey } from '@/api/types'
import { TASKS_PAGE_TABS, TaskSectionPanel, TasksPage } from './TasksPage'
import { resetTaskRows, useTaskRowsFeed } from './useTaskRows'

const mocked = vi.mocked(api)

const TASK = { ...TASK_TYPE, basic: true }
const pad = (n: number) => String(n).padStart(2, '0')
const dayOffset = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const day = (n: number) => ({ start: dayOffset(n), resolution: 'day' as const })

const ROWS: Row[] = [
  taskRow('Tasks/Fresh.md', { status: ['Not Started'] }, 'v1'),
  taskRow('Tasks/Overdue.md', { status: ['Next Up'], date: day(-3) }, 'v2'),
  taskRow('Tasks/Working.md', { status: ['In Progress'], date: day(0), priority: ['High'] }, 'v3'),
  taskRow('Tasks/Waiting.md', { status: ['On Hold'], date: day(5) }, 'v4'),
  taskRow('Tasks/Finished.md', { status: ['Done'], date: day(0) }, 'v5'),
  taskRow(
    'Tasks/Weekly.md',
    { status: ['Not Started'], date: day(1), repeat: 'every week', remind: 'on the day at 09:00', deadline: day(4) },
    'v6',
  ),
]

const BASE_UI: UiState = { pinned: [], sections: [], allNotesLayout: 'list' }

/** A list view of the Tasks dashboard as the page mounts it: the page's rows feed and the section. */
function Section({ k }: { k: TaskSectionKey }) {
  useTaskRowsFeed()
  return <TaskSectionPanel sectionKey={k} />
}
const show = (k: TaskSectionKey) => render(<Section k={k} />)
const titlesIn = (el: HTMLElement) => within(el).queryAllByText(/^(Fresh|Overdue|Working|Waiting|Finished|Weekly)$/).map((n) => n.textContent)

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
  resetPinned()
  resetTaskRows()
  useTabs.getState().reset()
  usePeek.getState().close()
  dragEnd = undefined
  useDefs.setState({ collections: [], queries: [], loaded: true })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.rows.mockResolvedValue(ROWS)
  mocked.ui.mockResolvedValue({ ui: BASE_UI, revision: 'u1' })
  mocked.patchUi.mockImplementation(async (patch) => ({ ui: { ...BASE_UI, ...patch }, revision: 'u2' }))
  mocked.createObject.mockResolvedValue({ path: 'Tasks/New.md', version: 'v1' })
  mocked.templates.mockResolvedValue([])
  useLinkIndex.setState({ types: [TASK], objects: [], loaded: true })
})

afterEach(() => {
  vi.useRealTimers()
})

// Gene's redesign, phase 2: the old Tasks page (header and section tabs) is retired; each section is a
// list view of the Tasks dashboard. These are the old page's tests, on the list views.
describe('Task list views (TaskSectionPanel)', () => {
  test('test the Inbox list holds tasks with no status or no date', async () => {
    show('inbox')
    const view = await screen.findByTestId('data-view')
    await waitFor(() => expect(titlesIn(view).sort()).toEqual(['Fresh']))
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['task'], preview: false })
  })

  test('test the Status list groups tasks by category, defaults to kanban and offers every FULL_VIEW_LAYOUTS layout', async () => {
    const user = userEvent.setup()
    show('status')
    await screen.findAllByTestId('kanban-column')
    const cols = screen.getAllByTestId('kanban-column')
    expect(cols.map((c) => c.getAttribute('data-group'))).toEqual(['not-started', 'in-progress', 'blocked', 'done'])
    expect(within(cols[0]).getByText('Not started')).toBeInTheDocument()
    expect(titlesIn(cols[0]).sort()).toEqual(['Fresh', 'Overdue', 'Weekly'])
    expect(titlesIn(cols[1])).toEqual(['Working'])
    expect(titlesIn(cols[2])).toEqual(['Waiting'])
    expect(titlesIn(cols[3])).toEqual(['Finished'])

    await user.click(screen.getByRole('button', { name: 'Layout' }))
    const offered = (await screen.findAllByRole('menuitemcheckbox')).length
    expect(offered).toBe(FULL_VIEW_LAYOUTS.length)
  })

  test('test the Today list includes overdue and today, done ones too (decision T1: the Calendar Day view\u2019s rule)', async () => {
    show('today')
    const view = await screen.findByTestId('data-view')
    await waitFor(() => expect(titlesIn(view)).toEqual(['Overdue', 'Working', 'Finished']))
  })

  test('the Today list moves on at midnight', async () => {
    const now = new Date()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 30))
    show('today')
    await waitFor(() => expect(titlesIn(screen.getByTestId('data-view'))).toEqual(['Overdue', 'Working', 'Finished']))
    // Past midnight, tomorrow's Weekly is due today; yesterday's done Finished leaves the list.
    await act(async () => {
      vi.advanceTimersByTime(90_000)
    })
    await waitFor(() => expect(titlesIn(screen.getByTestId('data-view'))).toEqual(['Overdue', 'Working', 'Weekly']))
  })

  test('test a list view change is saved to ui.tasks.views', async () => {
    const user = userEvent.setup()
    show('open')
    await screen.findByTestId('data-view')
    await user.click(screen.getByRole('button', { name: 'Layout' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Table' }))
    await waitFor(
      () => {
        const last = mocked.patchUi.mock.calls[mocked.patchUi.mock.calls.length - 1]
        const tasks = (last[0] as { tasks: { views: Record<string, { viewDefinition: { dataViewLayout: string } }> } }).tasks
        expect(tasks.views.open.viewDefinition.dataViewLayout).toBe('table')
        expect(last[1]).toEqual({ baseRevision: 'u1' })
      },
      { timeout: 2000 },
    )
  })

  test('a saved view is used on load', async () => {
    mocked.ui.mockResolvedValue({
      ui: {
        ...BASE_UI,
        tasks: {
          activeTab: 'inbox',
          views: {
            completed: {
              viewDefinition: { dataViewLayout: 'table' },
              filterGroup: { type: 'filterGroup', operator: 'and', elements: [] },
              sorts: [],
              groupBy: null,
            },
          },
        },
      },
      revision: 'u1',
    })
    show('completed')
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  test('test ui 409 refetches and reapplies once', async () => {
    const user = userEvent.setup()
    const other = { ...BASE_UI, pinned: [{ kind: 'type' as const, id: 'page' }] }
    show('status')
    await screen.findAllByTestId('kanban-column')
    mocked.patchUi.mockRejectedValueOnce(new ConflictError('u9'))
    mocked.ui.mockResolvedValue({
      ui: { ...other, tasks: { activeTab: 'status', views: { today: TASKS_TODAY_SAVED } } },
      revision: 'u9',
    })
    mocked.patchUi.mockImplementation(async (patch) => ({ ui: { ...other, ...patch }, revision: 'u10' }))
    await user.click(screen.getByRole('button', { name: 'Layout' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Table' }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledTimes(2), { timeout: 2000 })
    const [patch, opts] = mocked.patchUi.mock.calls[1]
    const tasks = (patch as { tasks: { views: Record<string, { viewDefinition: { dataViewLayout: string } }> } }).tasks
    expect(opts).toEqual({ baseRevision: 'u9' })
    // The fresh stored sections are kept and the edit re-applied on top of the fresh status view.
    expect(tasks.views.today).toEqual(TASKS_TODAY_SAVED)
    expect(tasks.views.status.viewDefinition.dataViewLayout).toBe('table')
    expect(mocked.ui).toHaveBeenCalledTimes(2)
  })

  test('test kanban drop to a category writes first status of the category', async () => {
    const fresh = taskRow('Tasks/Fresh.md', { status: ['In Progress'] }, 'v1b')
    mocked.updateProperties.mockResolvedValueOnce({
      version: 'v1b',
      frontmatter: {},
      links: {},
      synced: [],
      skipped: [],
      task: null,
    })
    show('status')
    await screen.findAllByTestId('kanban-column')
    mocked.rows.mockResolvedValueOnce([fresh])
    await act(async () => {
      dragEnd?.({ active: { id: 'Tasks/Fresh.md' }, over: { id: 'col:in-progress' } })
    })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/Fresh.md', { status: ['In Progress'] }, 'v1'))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Tasks/Fresh.md'] }))
    const cols = screen.getAllByTestId('kanban-column')
    await waitFor(() => expect(titlesIn(cols[1]).sort()).toEqual(['Fresh', 'Working']))
  })

  test('test dropping a recurring task into Done shows the moved toast and the reloaded card is open', async () => {
    const next = dayOffset(8)
    const res: UpdateResult = {
      version: 'v6b',
      frontmatter: {},
      links: {},
      synced: [],
      skipped: [],
      task: { completed: true, advanced: true, date: { start: next, resolution: 'day' } },
    }
    mocked.updateProperties.mockResolvedValueOnce(res)
    show('status')
    await screen.findAllByTestId('kanban-column')
    mocked.rows.mockResolvedValueOnce([
      taskRow('Tasks/Weekly.md', { status: ['Not Started'], date: { start: next, resolution: 'day' }, repeat: 'every week' }, 'v6b'),
    ])
    await act(async () => {
      dragEnd?.({ active: { id: 'Tasks/Weekly.md' }, over: { id: 'col:done' } })
    })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/Weekly.md', { status: ['Done'] }, 'v6'))
    expect(await screen.findByText(`Moved to ${next}`)).toBeInTheDocument()
    const cols = screen.getAllByTestId('kanban-column')
    expect(titlesIn(cols[0])).toContain('Weekly')
    expect(titlesIn(cols[3])).toEqual(['Finished'])
  })

  test('test the quick add on a list view creates a task', async () => {
    const user = userEvent.setup()
    show('inbox')
    await screen.findByTestId('data-view')
    const box = screen.getByRole('textbox', { name: /task/i })
    await user.type(box, 'Call Pat{Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', expect.objectContaining({ title: 'Call Pat' })))
  })

  test('test task rows show checkbox, repeat and reminder icons, deadline label and priority', async () => {
    show('open')
    const view = await screen.findByTestId('data-view')
    await waitFor(() => expect(within(view).getByText('Weekly')).toBeInTheDocument())
    expect(within(view).getAllByRole('checkbox').length).toBeGreaterThanOrEqual(5)
    expect(within(view).getByTestId('task-repeat')).toBeInTheDocument()
    expect(within(view).getByTestId('task-reminder')).toBeInTheDocument()
    expect(within(view).getByText('4 days left')).toBeInTheDocument()
    expect(within(view).getByText('High')).toBeInTheDocument()
  })

  test('the checkbox completes a task, patches the reloaded row and shows the moved toast', async () => {
    const user = userEvent.setup()
    const next = dayOffset(8)
    mocked.updateProperties.mockResolvedValueOnce({
      version: 'v6b',
      frontmatter: {},
      links: {},
      synced: [],
      skipped: [],
      task: { completed: true, advanced: true, date: { start: next, resolution: 'day' } },
    })
    show('recurring')
    const view = await screen.findByTestId('data-view')
    await waitFor(() => expect(within(view).getByText('Weekly')).toBeInTheDocument())
    mocked.rows.mockResolvedValueOnce([
      taskRow('Tasks/Weekly.md', { status: ['Not Started'], date: { start: next, resolution: 'day' }, repeat: 'every week' }, 'v6b'),
    ])
    await user.click(within(view).getAllByRole('checkbox')[0])
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/Weekly.md', { status: ['Done'] }, 'v6'))
    expect(await screen.findByText(`Moved to ${next}`)).toBeInTheDocument()
  })

  test('Reset view restores the section preset', async () => {
    const user = userEvent.setup()
    show('status')
    await screen.findAllByTestId('kanban-column')
    await user.click(screen.getByRole('button', { name: 'Layout' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Table' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /Customize/ }))
    await user.click(await screen.findByRole('button', { name: 'Reset view' }))
    // The page shows its back button ("Reset view") and the action below it.
    const buttons = await screen.findAllByRole('button', { name: 'Reset view' })
    expect(buttons).toHaveLength(2)
    await user.click(buttons[1])
    await waitFor(() => expect(screen.getAllByTestId('kanban-column')).toHaveLength(4))
  })
})

// M32 contract: the plain Tasks page is its own page again (a stub over the lists; lane C builds it).
describe('TasksPage (M32 contract stub)', () => {
  test('test the Tasks page has the tabs Today, Upcoming, Inbox, All, Done and opens on Today', async () => {
    render(<TasksPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: 'Tasks' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Today', 'Upcoming', 'Inbox', 'All', 'Done'])
    expect(TASKS_PAGE_TABS.map((t) => t.section)).toEqual(['today', 'scheduled', 'inbox', 'all', 'completed'])
    expect(screen.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true')
    // Today's list, from the page's own rows feed (one fetch).
    expect(document.querySelector('[data-task-section="today"]')).not.toBeNull()
    const view = await screen.findByTestId('data-view')
    await waitFor(() => expect(titlesIn(view)).toEqual(['Overdue', 'Working', 'Finished']))
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    // None of the dashboard is here.
    expect(screen.queryByRole('textbox', { name: 'Brain dump' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Work views' })).toBeNull()
  })

  test('test a tab shows its section’s list', async () => {
    const user = userEvent.setup()
    render(<TasksPage />)
    await screen.findByTestId('data-view')
    await user.click(screen.getByRole('tab', { name: 'Inbox' }))
    expect(screen.getByRole('tab', { name: 'Inbox' })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-task-section="inbox"]')).not.toBeNull()
    await waitFor(() => expect(titlesIn(screen.getByTestId('data-view'))).toEqual(['Fresh']))
    await user.click(screen.getByRole('tab', { name: 'Done' }))
    expect(document.querySelector('[data-task-section="completed"]')).not.toBeNull()
    await waitFor(() => expect(titlesIn(screen.getByTestId('data-view'))).toEqual(['Finished']))
  })
})

const TASKS_TODAY_SAVED = {
  viewDefinition: { dataViewLayout: 'grid' as const },
  filterGroup: { type: 'filterGroup' as const, operator: 'and' as const, elements: [] },
  sorts: [],
  groupBy: null,
}
