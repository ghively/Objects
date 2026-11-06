// M23 Task 9: the view registry: the default order and keys, the counts on board.json, and views a
// later milestone registers (they show in the switcher after Tickets).
import { act, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { WorkBoard } from '@/api/types'
import { agentStatus, workAlerts } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { WorkPage } from '../page/WorkPage'
import { resetWorkData, useWorkData, type WorkDataState } from '../state/useWorkData'
import { loadWorkUi, useWorkUi } from '../state/useWorkUi'
import { registerWorkView, resetWorkViews, WORK_VIEWS, workViews, type WorkViewDef } from './registry'

const mocked = vi.mocked(api)
const board = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')

const data = (over: Partial<WorkDataState> = {}): WorkDataState => ({ ...useWorkData.getState(), board, ...over })
const countOf = (id: string, d: WorkDataState) => workViews().find((v) => v.id === id)!.count(d, NOW)

describe('work view registry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.clearAllMocks()
    window.localStorage.clear()
    loadWorkUi(null)
    resetWorkData()
    resetWorkViews()
  })
  afterEach(() => {
    resetWorkViews()
    vi.useRealTimers()
  })

  test('test the default order and keys', () => {
    expect(workViews().map((v) => v.label)).toEqual([
      'Now',
      'Flow',
      'Projects map',
      'Today',
      'On the floor',
      'Your queues',
      'Agent queue',
      'Stuck',
      'Wins',
      'Alerts',
      'Everything',
      'Tickets',
    ])
    expect(workViews().map((v) => v.key)).toEqual(['n', 'w', 'p', 't', 'o', 'q', 'h', 's', 'y', 'l', 'e', null])
    expect(WORK_VIEWS.map((v) => v.id)).toEqual([
      'now', 'flow', 'projects', 'today', 'floor', 'queues', 'agent', 'stuck', 'wins', 'alerts', 'everything', 'tickets',
    ])
  })

  test('test counts on board.json', () => {
    const d = data({
      agent: agentStatus({ carrying: 2 }),
      wins: { days: [], stepsDone: 4, itemsClosed: 1, objectsChanged: 9, got: [] },
      alerts: workAlerts({
        alerts: [
          { path: 'Alerts/a.md', title: 'Tray 2 jammed', source: 'printer-watch', severity: 'Critical', message: null, raisedAt: null, clearedAt: null, link: null, active: true },
          { path: 'Alerts/b.md', title: 'Toner low', source: 'printer-watch', severity: 'Info', message: null, raisedAt: null, clearedAt: null, link: null, active: true },
          { path: 'Alerts/c.md', title: 'Old', source: 'printer-watch', severity: 'Warning', message: null, raisedAt: null, clearedAt: '2026-11-04T00:00:00Z', link: null, active: false },
        ],
      }),
      general: { items: [{ id: 'f1', rev: 'r1', place: 'Line 3', what: 'Spare toner', found: null, collected: null }], revision: 'g1' },
    })
    // Gene's turn: Printer, Scanner firmware, Badge reader, Desk closed it, Hand edited, Waiting on Pat, Scanner rollout.
    expect(countOf('now', d)).toBe(7)
    expect(countOf('flow', d)).toBe(9) // the active items (Last week fix is done)
    expect(countOf('projects', d)).toBe(3) // Scanner rollout, Printers, No area
    expect(countOf('today', d)).toBe(1) // Waiting on Pat's deadline
    expect(countOf('floor', d)).toBe(1) // the general list's open row
    expect(countOf('queues', d)).toBe(8)
    expect(countOf('agent', d)).toBe(2)
    expect(countOf('stuck', d)).toBe(1) // Waiting on Pat: blocked and quiet 11 days
    expect(countOf('wins', d)).toBe(4)
    expect(countOf('alerts', d)).toBe(1) // active and not Info
    expect(countOf('everything', d)).toBe(10)
    expect(countOf('tickets', d)).toBe(3)

    // Energy Low: only the quick steps (Question, Approve).
    act(() => useWorkUi.getState().setEnergy('low'))
    expect(countOf('now', d)).toBe(3)
  })

  test('test registerWorkView adds and replaces', () => {
    const Extra = () => null
    const def: WorkViewDef = { id: 'captures', label: 'Captures', icon: 'ph-lightbulb', key: 'c', count: () => 0, Component: Extra }
    registerWorkView(def)
    expect(workViews().map((v) => v.id).slice(-2)).toEqual(['tickets', 'captures'])
    registerWorkView({ ...def, label: 'Brain dumps' })
    expect(workViews().filter((v) => v.id === 'captures').map((v) => v.label)).toEqual(['Brain dumps'])
    expect(workViews()).toHaveLength(13)
    registerWorkView({ ...WORK_VIEWS[1], label: 'Lanes' })
    expect(workViews()[1].label).toBe('Lanes')
    expect(workViews()).toHaveLength(13)
  })

  test('test a view registered before the page renders shows in the switcher after Tickets', async () => {
    mocked.workBoard.mockResolvedValue(board)
    registerWorkView({
      id: 'captures',
      label: 'Captures',
      icon: 'ph-lightbulb',
      key: 'c',
      count: () => 2,
      Component: () => createElement('div', { 'data-testid': 'captures-view' }),
    })
    render(createElement(WorkPage))
    const nav = screen.getByRole('navigation', { name: 'Work views' })
    const labels = within(nav)
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-work-view'))
    expect(labels.slice(-2)).toEqual(['tickets', 'captures'])
    await act(async () => {
      within(nav).getByRole('button', { name: /Captures/ }).click()
    })
    expect(screen.getByTestId('captures-view')).toBeInTheDocument()
  })
})
