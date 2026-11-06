import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAutomations } from '@/automations/useAutomations'
import { resetLinkIndex } from '@/links/linkIndex'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { agent, agentSchedule, automationRule, automationRun } from '@/test/mockApi'
import { AGENT_TABS, tabsFor } from './agentTabs'
import { SchedulesTab } from './SchedulesTab'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
const AGENT = agent({ id: RESEARCHER })

const WEEKLY = agentSchedule({
  id: 'r1',
  name: 'Weekly review',
  revision: 'a1',
  actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Review', model: null }],
  lastRun: automationRun({ ruleId: 'r1', at: new Date(Date.now() - 5 * 60_000).toISOString() }),
})
const DAILY = agentSchedule({
  id: 'r2',
  name: 'Daily digest',
  trigger: { kind: 'schedule', repeat: 'every day', time: '18:00', start: '2026-11-06' },
  actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Digest', model: null }],
})
const OTHER = agentSchedule({ id: 'r3', name: 'Assistant job' })
const PLAIN = automationRule({ id: 'r4', name: 'Stamp done' })
const BROKEN = agentSchedule({
  id: 'r5',
  name: 'Broken',
  readOnlyReason: 'This automation was written by a newer version.',
  actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'x', model: null }],
})

beforeEach(() => {
  vi.clearAllMocks()
  resetAutomations()
  resetLinkIndex()
  resetSpaceInfo()
  useSpaceInfo.setState({ space: { name: 'Notes' } as never, loaded: true })
  mocked.automations.mockResolvedValue([WEEKLY, DAILY, OTHER, PLAIN, BROKEN])
})

async function row(name: string) {
  return within(await screen.findByRole('listitem', { name }))
}

async function menu(name: string, item: string) {
  const user = userEvent.setup()
  await user.click((await row(name)).getByRole('button', { name: 'Schedule menu' }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

describe('SchedulesTab', () => {
  test('test the tab is registered last with order 80', () => {
    const tab = AGENT_TABS.find((t) => t.id === 'schedules')
    expect(tab).toMatchObject({ id: 'schedules', label: 'Schedules', order: 80 })
    expect(tab?.kinds).toBeUndefined()
    expect(tabsFor('local').at(-1)?.id).toBe('schedules')
    expect(tabsFor('remote').map((t) => t.id)).not.toContain('schedules')
  })

  test("test lists only this agent's schedules with summary and last run", async () => {
    render(<SchedulesTab agent={AGENT} />)
    const list = await screen.findByRole('list', { name: 'Schedules' })
    await waitFor(() =>
      expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Broken', 'Daily digest', 'Weekly review']),
    )
    const weekly = await row('Weekly review')
    expect(weekly.getByRole('switch', { name: 'Turned on: Weekly review' })).toHaveAttribute('aria-checked', 'true')
    expect(weekly.getByTestId('schedule-summary')).toHaveTextContent('Every week on Monday at')
    expect(weekly.getByTestId('schedule-last-run')).toHaveTextContent('Ran 5 minutes ago')
    expect((await row('Daily digest')).getByTestId('schedule-last-run')).toHaveTextContent('Never ran')
    const broken = await row('Broken')
    expect(broken.queryByRole('switch')).toBeNull()
    expect(broken.getByTestId('schedule-summary')).toHaveTextContent('This automation was written by a newer version.')
  })

  test('test an agent without schedules says so', async () => {
    mocked.automations.mockResolvedValue([OTHER, PLAIN])
    render(<SchedulesTab agent={AGENT} />)
    expect(await screen.findByText('No schedules yet.')).toBeInTheDocument()
  })

  test('test the heading names the open space', async () => {
    render(<SchedulesTab agent={AGENT} />)
    expect(
      await screen.findByText('Prompts this agent runs on a schedule in “Notes”, while that space is open. Each run is saved as an AI Chat.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New schedule' })).toBeEnabled()
  })

  test('test the switch saves enabled with the revision', async () => {
    const user = userEvent.setup()
    render(<SchedulesTab agent={AGENT} />)
    await user.click((await row('Weekly review')).getByRole('switch'))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledWith({ ...WEEKLY, enabled: false }, { baseRevision: 'a1' }))
  })

  test('test Delete moves the schedule to the trash', async () => {
    render(<SchedulesTab agent={AGENT} />)
    await menu('Weekly review', 'Delete')
    await waitFor(() => expect(mocked.deleteAutomation).toHaveBeenCalledWith('r1'))
  })

  test('test Edit opens the schedule dialog', async () => {
    render(<SchedulesTab agent={AGENT} />)
    await menu('Weekly review', 'Edit')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Edit schedule')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('Weekly review')).toBeInTheDocument()
  })

  test('test Run log shows the runs and links the chat', async () => {
    mocked.automationRuns.mockResolvedValue([
      automationRun({
        ruleId: 'r1',
        id: 'run1',
        trigger: { kind: 'schedule', path: null, scheduledFor: '2026-11-09T09:00:00.000Z', catchUp: false },
        actions: [{ index: 0, kind: 'runAgent', status: 'ok', path: 'AI Chats/Weekly review 2026-11-09.md', detail: 'Saved the chat.' }],
      }),
    ])
    const user = userEvent.setup()
    render(<SchedulesTab agent={AGENT} />)
    await menu('Weekly review', 'Run log')
    expect(mocked.automationRuns).toHaveBeenCalledWith('r1')
    const log = await screen.findByRole('list', { name: 'Run log' })
    const entry = within(log).getAllByRole('listitem').find((li) => li.hasAttribute('data-run'))!
    expect(entry).toHaveTextContent('Run an agent')
    expect(within(entry).getByRole('button', { name: 'Weekly review 2026-11-09' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Automations' }))
    expect(await screen.findByRole('listitem', { name: 'Weekly review' })).toBeInTheDocument()
  })

  test('test a read-only agent disables New schedule', async () => {
    render(<SchedulesTab agent={agent({ id: RESEARCHER, readOnlyReason: 'This folder is read-only.' })} />)
    expect(screen.getByRole('button', { name: 'New schedule' })).toBeDisabled()
    expect((await row('Weekly review')).getByRole('switch')).toBeDisabled()
  })
})
