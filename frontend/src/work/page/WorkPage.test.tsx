// M23 Task 9, Gene's redesign: the Tasks dashboard frame: the Tasks header and the bars on every
// view, the Drive row with More views, the task lists as views, Just one thing, energy, the agent
// pill, the search and a work target's view.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// Everything shows the titles it is given, so the search's filter can be read.
vi.mock('../views/EverythingView', async () => {
  const { createElement } = await import('react')
  return {
    EverythingView: ({ data }: { data: { board: { items: { title: string }[] } | null } }) =>
      createElement(
        'ul',
        { 'data-testid': 'everything' },
        (data.board?.items ?? []).map((i) => createElement('li', { key: i.title }, i.title)),
      ),
  }
})

import { api } from '@/api/client'
import type { WorkBoard } from '@/api/types'
import { agentStatus, workAlerts } from '@/test/mockApi'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { TASK_TYPE } from '@/tasks/taskFixtures'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData } from '../state/useWorkData'
import { loadWorkUi, useWorkUi } from '../state/useWorkUi'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { registerWorkView, resetWorkViews, workViews } from '../views/registry'
import { WorkPage } from './WorkPage'
import { clearWorkSearch } from './WorkTopBar'

const mocked = vi.mocked(api)
// Read before any beforeEach resets the registry: the views the page's glob registered at import (M24).
const registeredAtImport = workViews().map((v) => ({ id: v.id, label: v.label, key: v.key }))
const board = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')

const switcher = () => screen.getByRole('navigation', { name: 'Work views' })
const countOn = (id: string) => switcher().querySelector(`[data-work-view="${id}"] [data-count]`)?.textContent ?? null
const selectedView = () => switcher().querySelector('[aria-current="page"]')?.getAttribute('data-work-view')

async function show(view?: Parameters<typeof WorkPage>[0]['view']) {
  const r = render(<WorkPage view={view} />)
  await act(async () => {})
  return r
}

describe('WorkPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.clearAllMocks()
    window.localStorage.clear()
    loadWorkUi(null)
    resetWorkData()
    resetWorkViews()
    clearWorkSearch()
    resetLinkIndex()
    usePeek.getState().close()
    mocked.workBoard.mockResolvedValue(board)
  })
  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.removeAttribute('data-work-calm')
  })

  test('test the bars stay on every view', async () => {
    const user = userEvent.setup()
    await show()
    const ids = workViews().map((v) => v.id)
    expect(ids).toHaveLength(12)
    for (const id of ids) {
      const more = within(switcher()).queryByRole('button', { name: 'More views' })
      if (!switcher().querySelector(`[data-work-view="${id}"]`) && more) await user.click(more)
      await user.click(switcher().querySelector(`[data-work-view="${id}"]`) as HTMLElement)
      expect(selectedView()).toBe(id)
      expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create task' })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Energy' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Just one thing/ })).toBeInTheDocument()
      expect(screen.getByRole('searchbox', { name: 'Search work' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Brain dump' })).toBeInTheDocument()
    }
  })

  test('test the Drive row shows first and More views folds Plan, Manage and Review', async () => {
    const user = userEvent.setup()
    await show()
    const row = () =>
      within(switcher())
        .getAllByRole('button')
        .map((b) => b.getAttribute('data-work-view') ?? b.textContent)
    // Drive (of the default views): Now, Today, Your queues, Agent queue; the rest is folded.
    expect(row()).toEqual(['now', 'today', 'queues', 'agent', 'More views'])
    await user.click(within(switcher()).getByRole('button', { name: 'More views' }))
    expect(within(switcher()).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Plan', 'Review'])
    expect(
      within(within(switcher()).getByRole('region', { name: 'Plan' }))
        .getAllByRole('button')
        .map((b) => b.getAttribute('data-work-view')),
    ).toEqual(['flow', 'projects', 'floor'])
    expect(
      within(within(switcher()).getByRole('region', { name: 'Review' }))
        .getAllByRole('button')
        .map((b) => b.getAttribute('data-work-view')),
    ).toEqual(['stuck', 'wins', 'alerts', 'tickets', 'everything'])
    // Picking a folded view and folding again keeps it on the row.
    await user.click(switcher().querySelector('[data-work-view="wins"]') as HTMLElement)
    await user.click(within(switcher()).getByRole('button', { name: 'Fewer views' }))
    expect(row()).toEqual(['now', 'today', 'queues', 'agent', 'wins', 'More views'])
    expect(selectedView()).toBe('wins')
  })

  test('test the task lists are views of the dashboard (registered through the glob)', () => {
    const ids = registeredAtImport.map((v) => v.id)
    for (const id of ['list-inbox', 'list-scheduled', 'list-status', 'list-completed', 'list-all']) {
      expect(ids).toContain(id)
    }
    expect(registeredAtImport.find((v) => v.id === 'list-inbox')?.label).toBe('Inbox')
    // Phase 2: one Today — the day timeline with today's tasks; no separate Today list view.
    expect(ids).not.toContain('list-today')
    expect(registeredAtImport.find((v) => v.id === 'today')?.label).toBe('Today')
  })

  test('test Today shows the day timeline with today\u2019s tasks under it', async () => {
    await show('today')
    const body = document.querySelector('[data-work-view-body="today"]') as HTMLElement
    expect(body.querySelector('[data-work-view="today"]')).not.toBeNull() // the timeline
    const tasks = within(body).getByRole('region', { name: 'Today\u2019s tasks' })
    expect(tasks.querySelector('[data-task-section="today"]')).not.toBeNull()
    expect(within(tasks).getByRole('textbox', { name: 'Task title' })).toBeInTheDocument()
  })

  // The space's Hide Task Management hides the task lists (the old Tasks page), not the dashboard:
  // it is M23's Work page too, so it stays reachable with the work views and the timeline-only Today.
  test('test hide task management leaves out the task lists and keeps the work dashboard', async () => {
    const user = userEvent.setup()
    registerWorkView({ id: 'list-inbox', label: 'Inbox', icon: 'ph-tray', key: null, count: () => 0, Component: () => null })
    registerWorkView({ id: 'list-all', label: 'All', icon: 'ph-list', key: null, count: () => 0, Component: () => null })
    useSpaceInfo.setState({
      space: { name: 's', root: '/s', types: [], icon: null, description: null, hideTaskManagement: true, revision: 'r' },
      loaded: true,
    })
    try {
      const r = await show('today')
      const ids = () => [...switcher().querySelectorAll('[data-work-view]')].map((b) => b.getAttribute('data-work-view'))
      await user.click(within(switcher()).getByRole('button', { name: 'More views' }))
      expect(ids()).not.toContain('list-inbox')
      expect(ids()).not.toContain('list-all')
      expect(ids()).toEqual(expect.arrayContaining(['now', 'today', 'queues', 'agent', 'flow', 'stuck', 'everything']))
      // Today is the day timeline alone.
      const body = document.querySelector('[data-work-view-body="today"]') as HTMLElement
      expect(body.querySelector('[data-work-view="today"]')).not.toBeNull()
      expect(within(body).queryByRole('region', { name: 'Today\u2019s tasks' })).toBeNull()
      // A task list left open falls back to the dashboard's first view.
      r.unmount()
      await show('list-inbox')
      expect(selectedView()).toBe('now')
      // Showing task management again brings the lists back.
      act(() => useSpaceInfo.setState((st) => ({ space: st.space && { ...st.space, hideTaskManagement: false } })))
      expect(switcher().querySelector('[data-work-view="list-inbox"]')).not.toBeNull()
    } finally {
      resetSpaceInfo()
    }
  })

  test('test Create task creates a task and opens it in the peek', async () => {
    const user = userEvent.setup()
    useLinkIndex.setState({ types: [{ ...TASK_TYPE, basic: true }], objects: [], loaded: true })
    mocked.createObject.mockResolvedValue({ path: 'Tasks/New.md', version: 'v1' })
    mocked.templates.mockResolvedValue([])
    await show()
    await user.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', {}))
    await waitFor(() => expect(usePeek.getState().path).toBe('Tasks/New.md'))
  })

  test('test just one thing shows only Now and dims the app', async () => {
    const user = userEvent.setup()
    const r = await show('flow')
    expect(selectedView()).toBe('flow')
    await user.click(screen.getByRole('button', { name: /Just one thing/ }))
    expect(within(switcher()).getAllByRole('button')).toHaveLength(1)
    expect(selectedView()).toBe('now')
    expect(document.documentElement).toHaveAttribute('data-work-calm')
    r.unmount()
    expect(document.documentElement).not.toHaveAttribute('data-work-calm')
    // Off again: every view is back (the Drive row and More views).
    await show()
    expect(document.documentElement).toHaveAttribute('data-work-calm')
    await user.click(screen.getByRole('button', { name: /Just one thing/ }))
    expect(within(switcher()).getByRole('button', { name: 'More views' })).toBeInTheDocument()
    expect(within(switcher()).getAllByRole('button').length).toBeGreaterThan(1)
    expect(document.documentElement).not.toHaveAttribute('data-work-calm')
  })

  test('test energy filters Now', async () => {
    const user = userEvent.setup()
    await show()
    expect(countOn('now')).toBe('7')
    const low = within(screen.getByRole('group', { name: 'Energy' })).getByRole('button', { name: 'Low' })
    await user.click(low)
    expect(low).toHaveAttribute('aria-pressed', 'true')
    expect(useWorkUi.getState().energy).toBe('low')
    expect(countOn('now')).toBe('3')
    // Pressing the chosen one clears it.
    await user.click(low)
    expect(useWorkUi.getState().energy).toBeNull()
    expect(countOn('now')).toBe('7')
  })

  test('test the agent pill counts and opens the agent queue', async () => {
    const user = userEvent.setup()
    mocked.workAgent.mockResolvedValue(agentStatus({ carrying: 2 }))
    mocked.workAlerts.mockResolvedValue(
      workAlerts({
        alerts: [
          { path: 'Alerts/a.md', title: 'Tray 2 jammed', source: 'printer-watch', severity: 'Critical', message: null, raisedAt: null, clearedAt: null, link: null, active: true },
          { path: 'Alerts/b.md', title: 'Toner low', source: 'printer-watch', severity: 'Info', message: null, raisedAt: null, clearedAt: null, link: null, active: true },
        ],
      }),
    )
    await show()
    const pill = screen.getByRole('button', { name: 'Agent is carrying 2 · 1 alerts' })
    await user.click(pill)
    expect(selectedView()).toBe('agent')
  })

  test('test search switches to Everything and filters', async () => {
    const user = userEvent.setup()
    await show()
    const box = screen.getByRole('searchbox', { name: 'Search work' })
    await user.type(box, 'inc0012345')
    expect(selectedView()).toBe('everything')
    expect(within(screen.getByTestId('everything')).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'Printer jams on line 3',
    ])
    await user.clear(box)
    await user.type(box, 'scanners')
    expect(within(screen.getByTestId('everything')).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'Scanner firmware',
    ])
    await user.clear(box)
    await user.type(box, 'scanner')
    expect(within(screen.getByTestId('everything')).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'Scanner firmware',
      'Scanner rollout',
    ])
    await user.keyboard('{Escape}')
    expect(box).toHaveValue('')
    expect(within(screen.getByTestId('everything')).getAllByRole('listitem')).toHaveLength(10)
  })

  test('test a work target with a view opens it', async () => {
    const r = await show('stuck')
    expect(selectedView()).toBe('stuck')
    expect(useWorkUi.getState().view).toBe('stuck')
    r.rerender(<WorkPage view="wins" />)
    await act(async () => {})
    expect(selectedView()).toBe('wins')
  })

  test('test the page loads its parts on mount', async () => {
    await show()
    expect(mocked.workBoard).toHaveBeenCalled()
    expect(mocked.workFocus).toHaveBeenCalled()
    expect(mocked.workToday).toHaveBeenCalled()
    expect(mocked.workAlerts).toHaveBeenCalled()
    expect(mocked.workAgent).toHaveBeenCalled()
    expect(mocked.workCaptures).toHaveBeenCalledWith('needsYou')
    expect(mocked.workWins).toHaveBeenCalled()
    expect(mocked.generalFloor).toHaveBeenCalled()
  })

  test('test the page reloads the day once the clock passes midnight in the board zone', async () => {
    // The board (fixture) says today is 2026-11-05 in UTC; the clock is just after midnight on the 6th.
    vi.setSystemTime(new Date('2026-11-06T00:01:00.000Z'))
    await show()
    await act(async () => {})
    expect(mocked.workBoard).toHaveBeenCalledTimes(2)
    expect(mocked.workToday).toHaveBeenCalledTimes(2)
    expect(mocked.workFocus).toHaveBeenCalledTimes(2)
    expect(mocked.workCaptures).toHaveBeenCalledTimes(2)
    // The server (mock) still answers yesterday: the page asks once, it does not loop.
    await act(async () => {})
    await act(async () => {})
    expect(mocked.workBoard).toHaveBeenCalledTimes(2)
  })

  test('test WorkPage lists Captures (M24 registers it through the glob)', () => {
    expect(registeredAtImport).toContainEqual({ id: 'captures', label: 'Captures', key: null })
  })
})
