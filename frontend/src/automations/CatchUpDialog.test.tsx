import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { AutomationCatchUpItem, ChangeEvent, SpaceInfo } from '@/api/types'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { automationRun } from '@/test/mockApi'
import { CatchUpDialog, catchUpQuestion } from './CatchUpDialog'

const mocked = vi.mocked(api)
const SPACE: SpaceInfo = { name: 'Lab', root: '/Lab', types: [], icon: null, description: null, hideTaskManagement: false, revision: 's1' }

const item = (partial: Partial<AutomationCatchUpItem> & Pick<AutomationCatchUpItem, 'ruleId' | 'name'>): AutomationCatchUpItem => ({
  missed: ['2026-11-02T09:00:00.000Z', '2026-11-03T09:00:00.000Z', '2026-11-04T09:00:00.000Z'],
  count: 3,
  capped: false,
  createsObjects: false,
  ...partial,
})

const REVIEW = item({ ruleId: 'r1', name: 'Weekly review', createsObjects: true })
const BACKUP = item({ ruleId: 'r2', name: 'Backup' })

let listeners: ((e: ChangeEvent) => void)[] = []

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  listeners = []
  mocked.onChange.mockImplementation((cb) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
  mocked.automationCatchUp.mockResolvedValue([REVIEW, BACKUP])
})

describe('catchUpQuestion', () => {
  test('create or run, with the count', () => {
    expect(catchUpQuestion(REVIEW)).toBe('Create the 3 missed “Weekly review”?')
    expect(catchUpQuestion(BACKUP)).toBe('Run “Backup” for the 3 missed times?')
    const many = item({ ruleId: 'r3', name: 'Ping', count: 120, capped: true, missed: Array.from({ length: 50 }, (_, i) => `2026-10-${i}`) })
    expect(catchUpQuestion(many)).toBe('Run “Ping” for the 50+ missed times?')
  })
})

describe('CatchUpDialog', () => {
  test('waits for the space, then asks for each missed rule', async () => {
    render(<CatchUpDialog />)
    expect(mocked.automationCatchUp).not.toHaveBeenCalled()
    act(() => useSpaceInfo.setState({ space: SPACE }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Missed automations' })
    expect(within(dialog).getByRole('listitem', { name: 'Weekly review' })).toHaveTextContent('Create the 3 missed “Weekly review”?')
    expect(within(dialog).getByRole('listitem', { name: 'Backup' })).toHaveTextContent('Run “Backup” for the 3 missed times?')
  })

  test('nothing missed shows nothing', async () => {
    mocked.automationCatchUp.mockResolvedValue([])
    useSpaceInfo.setState({ space: SPACE })
    render(<CatchUpDialog />)
    await waitFor(() => expect(mocked.automationCatchUp).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  test('each answer is sent for its rule; the dialog closes when all are answered', async () => {
    const user = userEvent.setup()
    useSpaceInfo.setState({ space: SPACE })
    render(<CatchUpDialog />)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(within(dialog).getByRole('listitem', { name: 'Weekly review' })).getByRole('button', { name: 'Only the latest' }))
    expect(mocked.confirmAutomationCatchUp).toHaveBeenCalledWith('r1', 'latest')
    await waitFor(() => expect(within(dialog).queryByRole('listitem', { name: 'Weekly review' })).toBeNull())
    await user.click(within(dialog).getByRole('button', { name: 'Skip' }))
    expect(mocked.confirmAutomationCatchUp).toHaveBeenCalledWith('r2', 'skip')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  test('a failed run stays on screen', async () => {
    const user = userEvent.setup()
    mocked.automationCatchUp.mockResolvedValue([BACKUP])
    mocked.confirmAutomationCatchUp.mockResolvedValue([automationRun({ ruleId: 'r2', status: 'failed', error: 'Disk full' })])
    useSpaceInfo.setState({ space: SPACE })
    render(<CatchUpDialog />)
    await user.click(await screen.findByRole('button', { name: 'Run all' }))
    expect(mocked.confirmAutomationCatchUp).toHaveBeenCalledWith('r2', 'all')
    expect(await screen.findByRole('alert')).toHaveTextContent('Backup: Disk full')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  test('Later closes without answering; a catch-up event asks again', async () => {
    const user = userEvent.setup()
    useSpaceInfo.setState({ space: SPACE })
    render(<CatchUpDialog />)
    await user.click(await screen.findByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocked.confirmAutomationCatchUp).not.toHaveBeenCalled()
    act(() => listeners.forEach((l) => l({ kind: 'automationRuns', path: 'r1' } as ChangeEvent)))
    expect(mocked.automationCatchUp).toHaveBeenCalledTimes(1)
    act(() => listeners.forEach((l) => l({ kind: 'automationRuns', path: 'catch-up' } as ChangeEvent)))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(mocked.automationCatchUp).toHaveBeenCalledTimes(2)
  })
})
