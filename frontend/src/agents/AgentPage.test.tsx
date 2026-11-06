import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { agent, ledgerSummary, remoteAgent } from '@/test/mockApi'
import { AgentPage, AGENT_PAGE_TEXT, openAgentTab, requestAgentTab } from './AgentPage'
import { LEARNING_TEXT } from './learningText'
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

  test('test the agent page lists Profile, Instructions, Tools, Memory, Skills, Learning, Chats in that order', async () => {
    mocked.agents.mockResolvedValue([agent({ id: 'assistant' }), agent({ id: RESEARCHER })])
    render(<AgentPage id={RESEARCHER} />)
    expect(await screen.findByRole('heading', { name: 'Researcher' })).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: AGENT_PAGE_TEXT.tabs })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Profile', 'Instructions', 'Tools', 'Memory', 'Skills', 'Learning', 'Chats'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: PROFILE_TEXT.name })).toHaveValue('Researcher')
  })

  test('test a remote agent page shows Profile, Card and Chats only', async () => {
    const PLANNER = '01JREMOTE00000000000000001'
    useAgents.setState({ agents: [agent({ id: 'assistant' }), remoteAgent({ id: PLANNER })], loaded: true })
    const user = userEvent.setup()
    // A tab a remote agent doesn't have shows its first tab.
    render(<AgentPage id={PLANNER} tab="memory" />)
    expect(screen.getByRole('heading', { name: 'Fake Planner' })).toBeInTheDocument()
    expect(screen.getByLabelText('Remote agent')).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: AGENT_PAGE_TEXT.tabs })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Profile', 'Card', 'Chats'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-agent-tab="remoteProfile"]')).not.toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Card' }))
    expect(document.querySelector('[data-agent-tab="card"]')).not.toBeNull()
    expect(screen.getByText("A synthetic agent for Object's tests.")).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(await screen.findByRole('searchbox', { name: 'Search chats' })).toBeInTheDocument()
    expect(mocked.agentChats).toHaveBeenCalledWith(PLANNER)
    expect(mocked.agentTools).not.toHaveBeenCalled()
    expect(mocked.agentInstructions).not.toHaveBeenCalled()
  })

  test('test the tab prop opens that tab', async () => {
    useAgents.setState({ agents: [agent({ id: RESEARCHER })], loaded: true })
    render(<AgentPage id={RESEARCHER} tab="chats" />)
    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('searchbox', { name: 'Search chats' })).toBeInTheDocument()
  })

  test('test an open agent page switches to a newly opened tab', async () => {
    useAgents.setState({ agents: [agent({ id: RESEARCHER })], loaded: true })
    const { rerender } = render(<AgentPage id={RESEARCHER} tab="profile" />)
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
    rerender(<AgentPage id={RESEARCHER} tab="memory" />)
    expect(screen.getByRole('tab', { name: 'Memory' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(LEARNING_TEXT.memoryIntro)).toBeInTheDocument()
    rerender(<AgentPage id={RESEARCHER} tab="skills" />)
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-agent-tab="skills"]')).not.toBeNull())
  })

  test('test opening the same agent tab again switches back from a hand-picked tab', async () => {
    useAgents.setState({ agents: [agent({ id: RESEARCHER })], loaded: true })
    const user = userEvent.setup()
    render(<AgentPage id={RESEARCHER} tab="memory" />)
    expect(screen.getByRole('tab', { name: 'Memory' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
    // the same target again: the tab prop doesn't change
    act(() => openAgentTab(RESEARCHER, 'memory'))
    expect(screen.getByRole('tab', { name: 'Memory' })).toHaveAttribute('aria-selected', 'true')
    // another agent's ask leaves this page alone
    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    act(() => requestAgentTab('assistant', 'skills'))
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(document.querySelector('[data-agent-tab]')).not.toBeNull())
  })

  test('test a read-only agent disables memory and learning fields', async () => {
    const reason = 'This agent was made by a newer version of Object.'
    mocked.agentMemory.mockResolvedValue({
      memory: { target: 'memory', text: 'Racks are labelled by row.', entries: ['Racks are labelled by row.'], chars: 26, cap: 2200, revision: 'm1' },
      user: { target: 'user', text: '', entries: [], chars: 0, cap: 1375, revision: null },
    })
    mocked.agentLedger.mockImplementation(async (_id, q) => ({
      entries: q?.target === 'memory' ? [ledgerSummary({ id: '01JLEDGER00000000000000001' })] : [],
      more: false,
    }))
    useAgents.setState({ agents: [agent({ id: RESEARCHER, readOnlyReason: reason })], loaded: true })
    const user = userEvent.setup()
    render(<AgentPage id={RESEARCHER} tab="memory" />)
    const memory = await screen.findByRole('textbox', { name: LEARNING_TEXT.memory })
    await waitFor(() => expect(memory).toHaveAttribute('contenteditable', 'false'))
    expect(screen.getByRole('textbox', { name: LEARNING_TEXT.user })).toHaveAttribute('contenteditable', 'false')
    expect(await screen.findByRole('button', { name: `${LEARNING_TEXT.undo}: Saved a memory` })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: 'Learning' }))
    const numbers = await screen.findAllByRole('spinbutton')
    expect(numbers).toHaveLength(6)
    for (const n of numbers) expect(n).toBeDisabled()
    for (const s of screen.getAllByRole('switch')) expect(s).toBeDisabled()
    expect(screen.getByRole('button', { name: LEARNING_TEXT.reviewModel })).toBeDisabled()
    expect(screen.getByRole('button', { name: LEARNING_TEXT.reset })).toBeDisabled()
    expect(mocked.saveAgentMemory).not.toHaveBeenCalled()
    expect(mocked.saveAgentLearning).not.toHaveBeenCalled()
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
