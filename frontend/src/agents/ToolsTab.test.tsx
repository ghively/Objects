import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { ToolGroup } from '@/api/types'
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
    mocked.saveAgent.mockImplementation(async (id, input, base) => agent({ id, toolsOff: input.toolsOff ?? [], revision: `${base}+1` }))
  })
  afterEach(() => resetAgents())

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
