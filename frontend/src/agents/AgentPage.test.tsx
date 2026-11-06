import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { agent } from '@/test/mockApi'
import { AgentPage, AGENT_PAGE_TEXT } from './AgentPage'
import { PROFILE_TEXT } from './ProfileTab'
import { resetAgents, useAgents } from './useAgents'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

describe('AgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
  })
  afterEach(() => resetAgents())

  test('test the page shows the agent and its four tabs, Profile first', async () => {
    mocked.agents.mockResolvedValue([agent({ id: 'assistant' }), agent({ id: RESEARCHER })])
    render(<AgentPage id={RESEARCHER} />)
    expect(await screen.findByRole('heading', { name: 'Researcher' })).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: AGENT_PAGE_TEXT.tabs })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Profile', 'Instructions', 'Tools', 'Chats'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: PROFILE_TEXT.name })).toHaveValue('Researcher')
  })

  test('test the tab prop opens that tab', async () => {
    useAgents.setState({ agents: [agent({ id: RESEARCHER })], loaded: true })
    render(<AgentPage id={RESEARCHER} tab="chats" />)
    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('searchbox', { name: 'Filter chats' })).toBeInTheDocument()
  })

  test('test an unlisted agent says so', async () => {
    mocked.agents.mockResolvedValue([agent({ id: 'assistant' })])
    render(<AgentPage id={RESEARCHER} />)
    expect(await screen.findByText(AGENT_PAGE_TEXT.notListed)).toBeInTheDocument()
  })

  test('test Open folder calls revealAgentFolder', async () => {
    useAgents.setState({ agents: [agent({ id: RESEARCHER })], loaded: true })
    const user = userEvent.setup()
    render(<AgentPage id={RESEARCHER} />)
    expect(screen.getByText('/state/agents/Researcher')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: PROFILE_TEXT.openFolder }))
    expect(mocked.revealAgentFolder).toHaveBeenCalledWith(RESEARCHER)
  })

  test('test a read-only agent disables every field', async () => {
    const reason = 'This agent was made by a newer version of Object.'
    mocked.agentTools.mockResolvedValue([
      { id: 'builtin', label: 'Claude Code built-ins', tools: [{ id: 'Read', label: 'Read files', on: true, warning: null }] },
    ])
    mocked.agentInstructions.mockResolvedValue({ text: 'Be brief.', revision: 'i1' })
    useAgents.setState({ agents: [agent({ id: RESEARCHER, readOnlyReason: reason })], loaded: true })
    const user = userEvent.setup()
    render(<AgentPage id={RESEARCHER} />)
    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: PROFILE_TEXT.name })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: PROFILE_TEXT.description })).toBeDisabled()
    expect(screen.getByRole('button', { name: PROFILE_TEXT.icon })).toBeDisabled()
    expect(screen.getByRole('button', { name: PROFILE_TEXT.model })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: 'Tools' }))
    const switches = await screen.findAllByRole('switch')
    expect(switches.length).toBeGreaterThan(0)
    for (const s of switches) expect(s).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: 'Instructions' }))
    const editor = await screen.findByRole('textbox', { name: 'Instructions' })
    await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'false'))
    expect(mocked.saveAgent).not.toHaveBeenCalled()
  })
})
