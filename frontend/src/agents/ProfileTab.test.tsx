import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, RevisionConflictError } from '@/api/client'
import type { Agent } from '@/api/types'
import { MCP_TEXT } from '@/mcp/mcpText'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { agent } from '@/test/mockApi'
import { PROFILE_TEXT, ProfileTab } from './ProfileTab'
import { resetAgents, useAgents } from './useAgents'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

/** The Profile tab of the agent `id` as the shared list has it (as the agent page renders it). */
function Live({ id }: { id: string }) {
  const a = useAgents((s) => s.agents.find((x) => x.id === id))
  return a ? <ProfileTab agent={a} /> : null
}

function seed(...agents: Agent[]) {
  useAgents.setState({ agents, loaded: true })
}

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
    useSettings.setState({ settings: { ...settingsDefaults } })
  })
  afterEach(() => resetAgents())

  test('test Profile saves the name with the revision and reloads on 409', async () => {
    seed(agent({ id: RESEARCHER, revision: 'r1', description: 'Reads things' }))
    mocked.saveAgent.mockImplementationOnce(async (id, input) => agent({ id, name: input.name, description: input.description, revision: 'r2' }))
    const user = userEvent.setup()
    render(<Live id={RESEARCHER} />)
    const name = screen.getByRole('textbox', { name: PROFILE_TEXT.name })
    await user.clear(name)
    await user.type(name, 'Reader{Enter}')
    await waitFor(() => expect(mocked.saveAgent).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgent).toHaveBeenCalledWith(
      RESEARCHER,
      { name: 'Reader', icon: 'ph-robot', color: null, description: 'Reads things', model: null, toolsOff: ['Bash'], learning: null },
      'r1',
    )
    await waitFor(() => expect(useAgents.getState().byId(RESEARCHER)?.revision).toBe('r2'))

    // A save against a stale revision: the tab reloads the agent and asks for the change again.
    mocked.saveAgent.mockRejectedValueOnce(new RevisionConflictError('r9'))
    mocked.agent.mockResolvedValueOnce(agent({ id: RESEARCHER, name: 'Renamed elsewhere', revision: 'r9' }))
    const description = screen.getByRole('textbox', { name: PROFILE_TEXT.description })
    await user.type(description, '!')
    await user.tab()
    await waitFor(() => expect(mocked.saveAgent).toHaveBeenCalledTimes(2))
    expect(mocked.saveAgent.mock.calls[1][2]).toBe('r2')
    expect(await screen.findByRole('status')).toHaveTextContent(PROFILE_TEXT.conflict)
    expect(mocked.agent).toHaveBeenCalledWith(RESEARCHER)
    await waitFor(() => expect(screen.getByRole('textbox', { name: PROFILE_TEXT.name })).toHaveValue('Renamed elsewhere'))
    expect(useAgents.getState().byId(RESEARCHER)?.revision).toBe('r9')
  })

  test("test the default agent's model edits the Settings model", async () => {
    seed(agent({ id: 'assistant', model: 'sonnet', revision: 'r1' }))
    mocked.saveAgent.mockImplementationOnce(async (id) => agent({ id, model: 'claude-opus-5-5', revision: 'r2' }))
    mocked.settings.mockResolvedValueOnce({ settings: { ...settingsDefaults, aiModel: 'claude-opus-5-5' }, revision: 's2' })
    const user = userEvent.setup()
    render(<Live id="assistant" />)
    const trigger = screen.getByRole('button', { name: PROFILE_TEXT.model })
    await waitFor(() => expect(trigger).toHaveTextContent('Sonnet (latest)'))
    await user.click(trigger)
    const list = await screen.findByRole('listbox')
    await user.click(await within(list).findByRole('option', { name: 'Opus 5.5' }))
    await waitFor(() => expect(mocked.saveAgent).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgent.mock.calls[0][0]).toBe('assistant')
    expect(mocked.saveAgent.mock.calls[0][1].model).toBe('claude-opus-5-5')
    expect(mocked.saveAgent.mock.calls[0][2]).toBe('r1')
    // Settings shows the value the route wrote to `aiModel`.
    await waitFor(() => expect(useSettings.getState().settings.aiModel).toBe('claude-opus-5-5'))
    expect(mocked.patchSettings).not.toHaveBeenCalled()
    // The default agent can't be removed from the list.
    expect(screen.queryByRole('button', { name: PROFILE_TEXT.removeFromList })).toBeNull()
  })

  test('test Remove unregisters and folder servers missing secrets say so', async () => {
    seed(
      agent({
        id: RESEARCHER,
        mcpServers: [
          { name: 'github', missingVars: ['GH_TOKEN'], usable: false },
          { name: 'files', missingVars: [], usable: true },
        ],
      }),
    )
    const user = userEvent.setup()
    render(<Live id={RESEARCHER} />)
    expect(screen.getByText(PROFILE_TEXT.needsSecrets(['GH_TOKEN']))).toHaveTextContent('Needs secrets: GH_TOKEN')
    expect(screen.queryByText('files')).toBeNull()
    await user.click(screen.getByRole('button', { name: PROFILE_TEXT.removeFromList }))
    expect(mocked.unregisterAgent).toHaveBeenCalledWith(RESEARCHER)
    expect(mocked.deleteAgent).not.toHaveBeenCalled()
  })
})

describe('ProfileTab: missing secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
  })
  afterEach(() => resetAgents())

  test('test Needs secrets shows Set… per variable and saving calls setMcpSecret', async () => {
    seed(agent({ id: RESEARCHER, revision: 'r1', mcpServers: [{ name: 'github', missingVars: ['GH_TOKEN', 'GH_ORG'], usable: false }] }))
    mocked.agent.mockResolvedValueOnce(
      agent({ id: RESEARCHER, revision: 'r1', mcpServers: [{ name: 'github', missingVars: ['GH_ORG'], usable: false }] }),
    )
    const user = userEvent.setup()
    render(<Live id={RESEARCHER} />)
    const row = screen.getByText('github').closest('li') as HTMLElement
    expect(within(row).getByText('Needs secrets: GH_TOKEN, GH_ORG')).toBeInTheDocument()
    const buttons = within(row).getAllByRole('button', { name: new RegExp(`^${MCP_TEXT.setVar}`) })
    expect(buttons).toHaveLength(2)
    expect(buttons.map((b) => b.textContent)).toEqual([MCP_TEXT.setVar, MCP_TEXT.setVar])

    await user.click(within(row).getByRole('button', { name: `${MCP_TEXT.setVar} GH_TOKEN` }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: MCP_TEXT.setTitle('GH_TOKEN') })).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(MCP_TEXT.value), 's3cret-profile')
    await user.click(within(dialog).getByRole('button', { name: MCP_TEXT.save }))
    await waitFor(() => expect(mocked.setMcpSecret).toHaveBeenCalledWith('GH_TOKEN', 's3cret-profile'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The agent reloads: GH_TOKEN is no longer missing.
    expect(mocked.agent).toHaveBeenCalledWith(RESEARCHER)
    await waitFor(() => expect(screen.getByText('Needs secrets: GH_ORG')).toBeInTheDocument())
    expect(document.body.innerHTML).not.toContain('s3cret-profile')
  })
})
