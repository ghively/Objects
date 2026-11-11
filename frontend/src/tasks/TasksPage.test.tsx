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
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { resetPinned } from '@/shell/usePinned'
import { setWorkOn } from '@/test/workOn'
import { useDefs } from '@/types/useDefinitions'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { TASK_TYPE, taskRow } from './taskFixtures'
import type { TaskSectionKey } from '@/api/types'
import { TASKS_PAGE_TABS, TaskSectionPanel, TasksPage, tasksListForWorkView } from './TasksPage'
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
  resetSpaceInfo()
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

// M32, item 9: the plain Tasks page.
describe('TasksPage (M32)', () => {
  const groupsShown = () =>
    [...document.querySelectorAll('[data-task-group]')].map((g) => [g.querySelector('h2')?.textContent ?? null, titlesIn(g as HTMLElement)])

  test('test the Tasks page has the tabs Today, Upcoming, Inbox, All, Done and opens on Today', async () => {
    render(<TasksPage />)
    expect(document.querySelector('[data-tasks-page]')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: 'Tasks' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Today', 'Upcoming', 'Inbox', 'All', 'Done'])
    expect(TASKS_PAGE_TABS.map((t) => t.section)).toEqual(['today', 'scheduled', 'inbox', 'all', 'completed'])
    expect(screen.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true')
    // The header: search and New task; under it the quick add.
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Add a task' })).toBeInTheDocument()
    // Today: Overdue, then Today, each count shown once; from the page's own rows feed (one fetch).
    await waitFor(() =>
      expect(groupsShown()).toEqual([
        ['Overdue (1)', ['Overdue']],
        ['Today (2)', ['Working', 'Finished']],
      ]),
    )
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['task'], preview: false })
    // Opening the page writes nothing.
    expect(mocked.patchUi).not.toHaveBeenCalled()
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    // None of the dashboard is here.
    expect(screen.queryByRole('textbox', { name: 'Brain dump' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Work views' })).toBeNull()
  })

  // The M32 review, F8: the row says it is a tab list, so it answers a tab list's keys.
  test('test the tab row is one stop for Tab, and the arrow keys, Home and End move through it', async () => {
    const user = userEvent.setup()
    render(<TasksPage />)
    const tab = (name: string) => screen.getByRole('tab', { name })
    const stops = () => within(screen.getByRole('tablist', { name: 'Tasks' })).getAllByRole('tab').map((t) => t.getAttribute('tabindex'))
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1'])
    act(() => tab('Today').focus())
    await user.keyboard('{ArrowRight}')
    expect(tab('Upcoming')).toHaveFocus()
    expect(tab('Upcoming')).toHaveAttribute('aria-selected', 'true')
    expect(stops()).toEqual(['-1', '0', '-1', '-1', '-1'])
    await user.keyboard('{End}')
    expect(tab('Done')).toHaveFocus()
    expect(tab('Done')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(tab('Today')).toHaveFocus() // round to the first
    await user.keyboard('{ArrowLeft}')
    expect(tab('Done')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(tab('All')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(tab('Today')).toHaveFocus()
    expect(tab('Today')).toHaveAttribute('aria-selected', 'true')
    // With a list from "More" shown no tab is selected: the first is the row's stop.
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Status' }))
    await waitFor(() => expect(tab('Today')).toHaveAttribute('aria-selected', 'false'))
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1'])
  })

  test('test each tab shows its list: Upcoming by day, Inbox the undated, All, Done', async () => {
    const user = userEvent.setup()
    render(<TasksPage />)
    await screen.findByText('Overdue (1)')
    await user.click(screen.getByRole('tab', { name: 'Upcoming' }))
    expect(screen.getByRole('tab', { name: 'Upcoming' })).toHaveAttribute('aria-selected', 'true')
    const upcoming = groupsShown()
    expect(upcoming.map(([, titles]) => titles)).toEqual([['Weekly'], ['Waiting']])
    expect(upcoming[0][0]).toBe('Tomorrow (1)')
    expect(upcoming[1][0]).toMatch(/^\w+day, .+ \(1\)$/)
    await user.click(screen.getByRole('tab', { name: 'Inbox' }))
    expect(groupsShown()).toEqual([[null, ['Fresh']]])
    await user.click(screen.getByRole('tab', { name: 'All' }))
    expect(titlesIn(screen.getByTestId('task-list')).sort()).toEqual(['Finished', 'Fresh', 'Overdue', 'Waiting', 'Weekly', 'Working'])
    await user.click(screen.getByRole('tab', { name: 'Done' }))
    expect(groupsShown()).toEqual([[null, ['Finished']]])
    // No view is saved by moving between tabs.
    expect(mocked.patchUi).not.toHaveBeenCalled()
  })

  test('test a done task’s title is struck through and an overdue date uses the danger colour', async () => {
    render(<TasksPage />)
    const list = await screen.findByTestId('task-list')
    expect(within(list).getByText('Finished').className).toContain('line-through')
    expect(within(list).getByText('Working').className).not.toContain('line-through')
    const late = within(list).getByText('Overdue').closest('li') as HTMLElement
    expect(within(late).getByTestId('task-date').className).toContain('var(--danger)')
    const now = within(list).getByText('Working').closest('li') as HTMLElement
    expect(within(now).getByTestId('task-date').className).not.toContain('var(--danger)')
  })

  test('test the tick completes a task and the list follows', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockResolvedValueOnce({
      version: 'v2b',
      frontmatter: {},
      links: {},
      synced: [],
      skipped: [],
      task: { completed: true, advanced: false },
    })
    render(<TasksPage />)
    await screen.findByText('Overdue (1)')
    mocked.rows.mockResolvedValueOnce([taskRow('Tasks/Overdue.md', { status: ['Done'], date: day(-3) }, 'v2b')])
    const late = screen.getByText('Overdue').closest('li') as HTMLElement
    await user.click(within(late).getByRole('checkbox'))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/Overdue.md', { status: ['Done'] }, 'v2'))
    // Done and dated before today: it leaves Today (it is under Done now).
    await waitFor(() => expect(groupsShown()).toEqual([['Today (2)', ['Working', 'Finished']]]))
  })

  test('test a row’s date chip moves the task', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockResolvedValueOnce({ version: 'v1b', frontmatter: {}, links: {}, synced: [], skipped: [], task: null })
    render(<TasksPage />)
    await screen.findByText('Overdue (1)')
    await user.click(screen.getByRole('tab', { name: 'Inbox' }))
    const row = screen.getByText('Fresh').closest('li') as HTMLElement
    mocked.rows.mockResolvedValueOnce([taskRow('Tasks/Fresh.md', { status: ['Not Started'], date: day(0) }, 'v1b')])
    await user.click(within(row).getByRole('button', { name: 'Date: No date' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Today' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/Fresh.md', { date: day(0) }, 'v1'))
    await waitFor(() => expect(screen.getByText('No tasks without a date')).toBeInTheDocument())
  })

  test('test Search tasks filters the shown list as you type', async () => {
    const user = userEvent.setup()
    render(<TasksPage />)
    await screen.findByText('Overdue (1)')
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'work')
    expect(groupsShown()).toEqual([['Today (1)', ['Working']]])
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'zzz')
    expect(screen.getByText('No tasks match your search')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: 'Search tasks' }))
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument()
  })

  test('test Add a task adds without opening, with the date its words name', async () => {
    const user = userEvent.setup()
    render(<TasksPage />)
    await screen.findByText('Overdue (1)')
    const box = screen.getByRole('textbox', { name: 'Add a task' })
    await user.type(box, 'Call Pat tomorrow{Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', { title: 'Call Pat', body: '', values: { date: day(1) } }))
    await waitFor(() => expect(box).toHaveFocus())
    expect(usePeek.getState().path).toBeNull()
    expect(useTabs.getState().tabs.length).toBeLessThanOrEqual(1)
  })

  test('test New task creates a task and opens it', async () => {
    const user = userEvent.setup()
    render(<TasksPage />)
    await screen.findByText('Overdue (1)')
    await user.click(screen.getByRole('button', { name: 'New task' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', {}))
    await waitFor(() => {
      const tab = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)
      const target = tab?.history[tab.index]
      expect(usePeek.getState().path === 'Tasks/New.md' || (target?.kind === 'object' && target.path === 'Tasks/New.md')).toBe(true)
    })
  })

  test('test More holds Status, Deadline, Recurring, Reminders, Tags and Context, each the existing list', async () => {
    const user = userEvent.setup()
    render(<TasksPage />)
    await screen.findByText('Overdue (1)')
    await user.click(screen.getByRole('button', { name: 'More' }))
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(['Status', 'Deadline', 'Recurring', 'Reminders', 'Tags', 'Context'])
    await user.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    // The Status list as it is today: the kanban by status category; no tab is selected.
    await screen.findAllByTestId('kanban-column')
    expect(document.querySelector('[data-task-section="status"]')).not.toBeNull()
    expect(screen.getAllByRole('tab').every((t) => t.getAttribute('aria-selected') === 'false')).toBe(true)
    expect(screen.getByRole('button', { name: 'More' })).toHaveTextContent('Status')
    // One quick add on the page, the one on top.
    expect(screen.getAllByRole('textbox', { name: 'Add a task' })).toHaveLength(1)
    await user.click(screen.getByRole('tab', { name: 'Today' }))
    expect(await screen.findByText('Overdue (1)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toHaveTextContent('More')
  })

  test('test the last tab is remembered per space, in the browser', async () => {
    const user = userEvent.setup()
    setWorkOn(false) // a loaded space (root /space)
    const first = render(<TasksPage />)
    await screen.findByText('Overdue (1)')
    await user.click(screen.getByRole('tab', { name: 'Inbox' }))
    expect(localStorage.getItem('object.tasksTab:/space')).toBe('inbox')
    expect(mocked.patchUi).not.toHaveBeenCalled()
    first.unmount()
    render(<TasksPage />)
    expect(screen.getByRole('tab', { name: 'Inbox' })).toHaveAttribute('aria-selected', 'true')
    // Another space starts on Today.
    act(() => useSpaceInfo.setState({ space: { ...useSpaceInfo.getState().space!, root: '/other' } }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true'))
  })

  test('test `list` opens the page on that list without changing what is remembered', async () => {
    const user = userEvent.setup()
    localStorage.setItem('object.tasksTab', 'inbox')
    const { rerender } = render(<TasksPage list="today" />)
    expect(screen.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true')
    expect(localStorage.getItem('object.tasksTab')).toBe('inbox')
    // A pick still wins, and is remembered.
    await user.click(screen.getByRole('tab', { name: 'Done' }))
    expect(screen.getByRole('tab', { name: 'Done' })).toHaveAttribute('aria-selected', 'true')
    expect(localStorage.getItem('object.tasksTab')).toBe('completed')
    // Asked for another list: that one shows.
    rerender(<TasksPage list="scheduled" />)
    expect(screen.getByRole('tab', { name: 'Upcoming' })).toHaveAttribute('aria-selected', 'true')
    // The Work views a Tasks list stands in for while Work is off.
    expect(tasksListForWorkView('today')).toBe('today')
    expect(tasksListForWorkView('list-inbox')).toBe('inbox')
    expect(tasksListForWorkView('list-status')).toBe('status')
    expect(tasksListForWorkView('list-open')).toBeUndefined()
    expect(tasksListForWorkView('now')).toBeUndefined()
    expect(tasksListForWorkView(undefined)).toBeUndefined()
  })

  test('test a space with no Task type can still add: the type id falls back to task', async () => {
    const user = userEvent.setup()
    useLinkIndex.setState({ types: [], objects: [], loaded: true })
    mocked.rows.mockResolvedValue([])
    render(<TasksPage />)
    expect(await screen.findByText('No tasks today')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeEnabled()
    await user.type(screen.getByRole('textbox', { name: 'Add a task' }), 'First task{Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', { title: 'First task', body: '' }))
  })
})

const TASKS_TODAY_SAVED = {
  viewDefinition: { dataViewLayout: 'grid' as const },
  filterGroup: { type: 'filterGroup' as const, operator: 'and' as const, elements: [] },
  sorts: [],
  groupBy: null,
}
