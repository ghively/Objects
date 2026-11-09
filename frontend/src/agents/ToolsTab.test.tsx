import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { ChangeEvent, McpGroupStatus, ToolGroup } from '@/api/types'
import { MCP_TEXT } from '@/mcp/mcpText'
import { agent } from '@/test/mockApi'
import { AGENT_TEXT } from './agentText'
import { ToolsTab } from './ToolsTab'
import { resetAgents, useAgents } from './useAgents'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

const GROUPS: ToolGroup[] = [
  {
    id: 'builtin',
    label: 'Claude Code built-ins',
    tools: [
      { id: 'Bash', label: 'Shell (Bash, PowerShell)', on: false, warning: AGENT_TEXT.shellWarning },
      { id: 'Read', label: 'Read files', on: true, warning: null },
    ],
  },
]

function Live() {
  const a = useAgents((s) => s.agents.find((x) => x.id === RESEARCHER))
  return a ? <ToolsTab agent={a} /> : null
}

describe('ToolsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
    useAgents.setState({ agents: [agent({ id: RESEARCHER, toolsOff: ['Bash'], revision: 'r1' })], loaded: true })
    mocked.agentTools.mockResolvedValue(GROUPS)
    mocked.refreshAgentTools.mockResolvedValue(GROUPS)
    mocked.saveAgent.mockImplementation(async (id, input, base) => agent({ id, toolsOff: input.toolsOff ?? [], revision: `${base}+1` }))
  })
  afterEach(() => resetAgents())

  // Fix pass H (M19.6): a server turned off in Settings (another window or page) shows in an open
  // Tools tab without a reload.
  test('test an mcpServers change reloads the groups', async () => {
    let listener: (e: ChangeEvent) => void = () => undefined
    mocked.onChange.mockImplementation((fn: (e: ChangeEvent) => void) => {
      listener = fn
      return () => undefined
    })
    render(<Live />)
    await screen.findByRole('switch', { name: 'Read files' })
    await waitFor(() => expect(mocked.refreshAgentTools).toHaveBeenCalledTimes(1))
    mocked.agentTools.mockResolvedValue([...GROUPS, { id: 'later', label: 'Later group', tools: [{ id: 'X', label: 'Later tool', on: true, warning: null }] }])
    act(() => listener({ kind: 'mcpServers', path: '01JSRV', version: null, origin: null }))
    expect(await screen.findByRole('switch', { name: 'Later tool' })).toBeInTheDocument()
  })

  test('test Tools saves toolsOff and the shell asks first', async () => {
    const user = userEvent.setup()
    render(<Live />)
    expect(mocked.agentTools).toHaveBeenCalledWith(RESEARCHER)
    const read = await screen.findByRole('switch', { name: 'Read files' })
    await user.click(read)
    await waitFor(() => expect(mocked.saveAgent).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgent.mock.calls[0][0]).toBe(RESEARCHER)
    expect(mocked.saveAgent.mock.calls[0][1].toolsOff).toEqual(['Bash', 'Read'])
    expect(mocked.saveAgent.mock.calls[0][2]).toBe('r1')
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Read files' })).not.toBeChecked())

    // Turning the shell on asks first, with the warning verbatim; Cancel saves nothing.
    await user.click(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' }))
    let dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(AGENT_TEXT.shellWarning)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocked.saveAgent).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' })).not.toBeChecked()

    await user.click(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' }))
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(mocked.saveAgent).toHaveBeenCalledTimes(2))
    expect(mocked.saveAgent.mock.calls[1][1].toolsOff).toEqual(['Read'])
    expect(mocked.saveAgent.mock.calls[1][2]).toBe('r1+1')
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' })).toBeChecked())
  })
})

function server(partial: Partial<McpGroupStatus> = {}): McpGroupStatus {
  return { source: 'gateway', serverId: '01JSRV', name: 'fake', status: 'ok', error: null, fetchedAt: '2026-11-06T09:00:00.000Z', missingVars: [], ...partial }
}

const ECHO = { id: 'mcp__fake__echo', label: 'echo', on: true, warning: null }
const ADD = { id: 'mcp__fake__add', label: 'add', on: true, warning: null }

describe('ToolsTab: outside MCP servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
    useAgents.setState({ agents: [agent({ id: RESEARCHER, toolsOff: [], revision: 'r1' })], loaded: true })
    mocked.saveAgent.mockImplementation(async (id, input, base) => agent({ id, toolsOff: input.toolsOff ?? [], revision: `${base}+1` }))
  })
  afterEach(() => resetAgents())

  test('test the Tools tab refreshes server tools on open and shows Listing tools… meanwhile', async () => {
    mocked.agentTools.mockResolvedValue([...GROUPS, { id: 'mcp:fake', label: 'fake', tools: [], server: server({ status: 'unknown', fetchedAt: null }) }])
    let answer: (g: ToolGroup[]) => void = () => undefined
    mocked.refreshAgentTools.mockImplementation(() => new Promise<ToolGroup[]>((r) => (answer = r)))
    render(<Live />)
    expect(await screen.findByText(MCP_TEXT.listing)).toBeInTheDocument()
    expect(mocked.agentTools).toHaveBeenCalledWith(RESEARCHER)
    expect(mocked.refreshAgentTools).toHaveBeenCalledTimes(1)
    expect(mocked.refreshAgentTools).toHaveBeenCalledWith(RESEARCHER)
    answer([...GROUPS, { id: 'mcp:fake', label: 'fake', tools: [ADD, ECHO], server: server() }])
    const group = await screen.findByRole('region', { name: 'fake' })
    await waitFor(() => expect(within(group).getByRole('switch', { name: 'echo' })).toBeChecked())
    expect(screen.queryByText(MCP_TEXT.listing)).toBeNull()
    expect(mocked.refreshAgentTools).toHaveBeenCalledTimes(1)
  })

  test('test a new tool from the refresh shows switched on', async () => {
    useAgents.setState({ agents: [agent({ id: RESEARCHER, toolsOff: ['mcp__fake__echo'], revision: 'r1' })], loaded: true })
    mocked.agentTools.mockResolvedValue([{ id: 'mcp:fake', label: 'fake', tools: [{ ...ECHO, on: false }], server: server() }])
    mocked.refreshAgentTools.mockResolvedValue([{ id: 'mcp:fake', label: 'fake', tools: [ADD, { ...ECHO, on: false }], server: server() }])
    render(<Live />)
    const added = await screen.findByRole('switch', { name: 'add' })
    expect(added).toBeChecked()
    expect(screen.getByRole('switch', { name: 'echo' })).not.toBeChecked()
    expect(mocked.saveAgent).not.toHaveBeenCalled()
  })

  test('test switching one server tool off saves its mcp__server__tool id in toolsOff', async () => {
    mocked.agentTools.mockResolvedValue([{ id: 'mcp:fake', label: 'fake', tools: [ADD, ECHO], server: server() }])
    mocked.refreshAgentTools.mockResolvedValue([{ id: 'mcp:fake', label: 'fake', tools: [ADD, ECHO], server: server() }])
    const user = userEvent.setup()
    render(<Live />)
    await waitFor(() => expect(mocked.refreshAgentTools).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(MCP_TEXT.listing)).toBeNull())
    await user.click(await screen.findByRole('switch', { name: 'add' }))
    await waitFor(() => expect(mocked.saveAgent).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgent.mock.calls[0][1].toolsOff).toEqual(['mcp__fake__add'])
    expect(mocked.saveAgent.mock.calls[0][2]).toBe('r1')
  })
})
