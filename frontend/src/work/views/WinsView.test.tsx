// M23 Task 13: Wins: the KPIs, 14 bars, What got done newest first, and the closing line.
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import type { WinDay, WorkWins } from '@/api/types'
import { workBoard } from '@/test/mockApi'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { WinsView } from './WinsView'

const NOW = new Date('2026-11-05T10:00:00.000Z')

function days(): WinDay[] {
  const out: WinDay[] = []
  for (let k = 13; k >= 0; k -= 1) {
    const d = new Date(Date.UTC(2026, 10, 5 - k)).toISOString().slice(0, 10)
    out.push({ day: d, stepsDone: k === 0 ? 3 : k % 3, itemsClosed: k === 1 ? 1 : 0, objectsChanged: k === 0 ? 4 : 1 })
  }
  return out
}

const WINS: WorkWins = {
  days: days(),
  stepsDone: 17,
  itemsClosed: 2,
  objectsChanged: 21,
  got: [
    { at: '2026-11-04T15:00:00.000Z', kind: 'closed', path: 'Tasks/Last week fix.md', title: 'Last week fix', text: 'Closed' },
    { at: '2026-11-05T09:30:00.000Z', kind: 'step', path: 'Tasks/Scanner firmware.md', title: 'Scanner firmware', text: 'Step 1: Flash the floor units' },
  ],
}

function show(wins: WorkWins | null = WINS) {
  useWorkData.setState({ board: workBoard([]), wins })
  return render(<WinsView data={useWorkData.getState()} now={NOW} />)
}

describe('WinsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
  })

  test('test the kpis', () => {
    show()
    const kpi = (label: string) => screen.getByText(label).closest('[data-work-kpi]') as HTMLElement
    expect(within(kpi('Steps done in 14 days')).getByText('17')).toBeInTheDocument()
    expect(within(kpi('Items closed in 14 days')).getByText('2')).toBeInTheDocument()
    expect(within(kpi('Objects changed in 14 days')).getByText('21')).toBeInTheDocument()
    expect(within(kpi('Changed today')).getByText('4')).toBeInTheDocument()
  })

  test('test fourteen bars of steps done and items closed', () => {
    show()
    const bars = document.querySelectorAll('[data-win-bar]')
    expect(bars).toHaveLength(14)
    expect(bars[13]).toHaveAttribute('data-count', '3')
    expect(bars[12]).toHaveAttribute('data-count', String((1 % 3) + 1))
    expect(bars[13]).toHaveAttribute('data-day', '2026-11-05')
    // weekday labels (2026-11-05 is a Thursday)
    expect(within(bars[13].parentElement as HTMLElement).getByText('Thu')).toBeInTheDocument()
  })

  test('test what got done is newest first', () => {
    show()
    const rows = within(screen.getByRole('region', { name: 'What got done' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Scanner firmware')
    expect(rows[0]).toHaveTextContent('Step 1: Flash the floor units')
    expect(rows[1]).toHaveTextContent('Last week fix')
    expect(rows[1]).toHaveTextContent('Closed')
  })

  test('test the closing line is verbatim', () => {
    show()
    expect(screen.getByText('No streaks to break. This only grows.')).toBeInTheDocument()
  })
})
