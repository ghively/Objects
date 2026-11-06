// M23 Task 9: the Work page frame: the bars on every view, Just one thing, energy, the agent pill,
// the search and a work target's view.
import { act, render, screen, within } from '@testing-library/react'
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
import boardJson from '../__fixtures__/board.json'
import { resetWorkData } from '../state/useWorkData'
import { loadWorkUi, useWorkUi } from '../state/useWorkUi'
import { resetWorkViews } from '../views/registry'
import { WorkPage } from './WorkPage'
import { clearWorkSearch } from './WorkTopBar'

const mocked = vi.mocked(api)
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
    mocked.workBoard.mockResolvedValue(board)
  })
  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.removeAttribute('data-work-calm')
  })

  test('test the bars stay on every view', async () => {
    const user = userEvent.setup()
    await show()
    const labels = within(switcher())
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-work-view'))
    expect(labels).toHaveLength(12)
    for (const id of labels) {
      await user.click(switcher().querySelector(`[data-work-view="${id}"]`) as HTMLElement)
      expect(selectedView()).toBe(id)
      expect(screen.getByRole('group', { name: 'Energy' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Just one thing/ })).toBeInTheDocument()
      expect(screen.getByRole('searchbox', { name: 'Search work' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Brain dump' })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Focus lines' })).toBeInTheDocument()
    }
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
    // Off again: every view is back.
    await show()
    expect(document.documentElement).toHaveAttribute('data-work-calm')
    await user.click(screen.getByRole('button', { name: /Just one thing/ }))
    expect(within(switcher()).getAllByRole('button')).toHaveLength(12)
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
})
