// M24 Task 9: Settings > Work's work agent group.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { resetAgents } from '@/agents/useAgents'
import { agent, automationRule, deskSyncStatus, workAgentSettings } from '@/test/mockApi'
import { resetWorkToasts, useWorkToasts } from '@/work/state/workToasts'
import { WorkAgentSettings } from './WorkAgentSettings'
import { WORK_AGENT_TEXT as T } from './workAgentText'

const mocked = vi.mocked(api)
const WORK = agent({ id: 'w1', name: 'Work' })
const REMOTE = agent({ id: 'r1', name: 'Far away', kind: 'remote' })
const SERVERS = [
  {
    name: 'jira', source: 'folder' as const, listed: true,
    tools: [{ id: 'mcp:jira:get', name: 'get_issue', description: '', marked: false, serverSaysReadOnly: true }],
  },
  { name: 'snow', source: 'gateway' as const, listed: false, tools: [] },
]

beforeEach(() => {
  vi.clearAllMocks()
  resetAgents()
  resetWorkToasts()
  mocked.agents.mockResolvedValue([WORK, REMOTE])
  mocked.workAgentSettings.mockResolvedValue(workAgentSettings({ settingsRevision: 'rev1' }))
  mocked.workReadTools.mockResolvedValue(SERVERS)
  mocked.deskSync.mockResolvedValue(deskSyncStatus())
  mocked.workAgentCreateInfo.mockResolvedValue({ name: 'Work', changeReviewer: null })
})

describe('WorkAgentSettings', () => {
  test('test the picker lists only local agents and None', async () => {
    render(<WorkAgentSettings />)
    const picker = await screen.findByRole('combobox', { name: T.picker })
    await waitFor(() => expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([T.none, 'Work']))
  })

  test('test Create opens the dialog with the shell warning; the reviewer box only when found; posts createWorkAgent(true)', async () => {
    const user = userEvent.setup()
    mocked.workAgentCreateInfo.mockResolvedValue({ name: 'Work', changeReviewer: 'change-reviewer.md' })
    mocked.createWorkAgent.mockResolvedValue({ agent: WORK, settings: workAgentSettings({ agentId: 'w1', agent: WORK }) })
    render(<WorkAgentSettings />)
    await user.click(await screen.findByRole('button', { name: T.create }))
    expect(await screen.findByText(T.shellWarning)).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: new RegExp(T.copyReviewer) })).toBeChecked()
    await user.click(screen.getByRole('button', { name: T.confirm }))
    await waitFor(() => expect(mocked.createWorkAgent).toHaveBeenCalledWith(true))
  })

  test('test no reviewer checkbox without a change-reviewer file', async () => {
    const user = userEvent.setup()
    render(<WorkAgentSettings />)
    await user.click(await screen.findByRole('button', { name: T.create }))
    await screen.findByText(T.shellWarning)
    expect(screen.queryByRole('checkbox', { name: new RegExp(T.copyReviewer) })).toBeNull()
  })

  test('test the acts switch with no work agent opens the dialog instead of saving', async () => {
    const user = userEvent.setup()
    render(<WorkAgentSettings />)
    await user.click(await screen.findByRole('switch', { name: T.acts }))
    expect(await screen.findByText(T.shellWarning)).toBeInTheDocument()
    expect(mocked.saveWorkAgentSettings).not.toHaveBeenCalled()
  })

  test('test ticking a tool saves readTools with the revision; a 409 reloads and toasts', async () => {
    const user = userEvent.setup()
    mocked.saveWorkAgentSettings.mockRejectedValueOnce(new ConflictError('rev2'))
    render(<WorkAgentSettings />)
    await user.click(await screen.findByRole('checkbox', { name: /get_issue/ }))
    await waitFor(() => expect(mocked.saveWorkAgentSettings).toHaveBeenCalledWith({ readTools: ['mcp:jira:get'] }, 'rev1'))
    await waitFor(() => expect(useWorkToasts.getState().toasts.map((t) => t.text)).toEqual([T.changedElsewhere]))
    expect(mocked.workAgentSettings).toHaveBeenCalledTimes(2)
    expect(screen.getByText(T.notListed)).toBeInTheDocument()
  })

  test('test Set up Desk sync calls setUpDeskSync, then its switch saves the rule enabled', async () => {
    const user = userEvent.setup()
    mocked.setUpDeskSync.mockResolvedValue(deskSyncStatus({ ruleId: 'rule1', time: '07:00', repeat: 'every weekday' }))
    mocked.automation.mockResolvedValue(automationRule({ id: 'rule1', revision: 'a1' }))
    mocked.saveAutomation.mockResolvedValue({ rule: automationRule({ id: 'rule1' }) })
    render(<WorkAgentSettings />)
    await user.click(await screen.findByRole('button', { name: T.setUpDeskSync }))
    expect(mocked.setUpDeskSync).toHaveBeenCalled()
    expect(await screen.findByText(T.noReadTools)).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: T.deskSync }))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalled())
    const [rule, opts] = mocked.saveAutomation.mock.calls[0]
    expect(rule.enabled).toBe(true)
    expect(opts).toEqual({ baseRevision: 'a1' })
    expect(useWorkToasts.getState().toasts).toEqual([])
  })
})
