import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { AgentChatSummary, ChangeEvent } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { agent } from '@/test/mockApi'
import { CHATS_TEXT, ChatsTab, delegatedLine, snippetPieces } from './ChatsTab'
import { resetAgents, useAgents } from './useAgents'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
const CHAT_A = '01JD0000000000000000000001'
const CHAT_B = '01JD0000000000000000000002'
const realOpenInSidepanel = useTabs.getState().openInSidepanel

function chat(id: string, title: string, partial: Partial<AgentChatSummary> = {}): AgentChatSummary {
  return {
    id,
    title,
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: '2026-11-05T09:01:00.000Z',
    messageCount: 2,
    spaceName: 'Notes',
    delegated: false,
    from: null,
    ...partial,
  }
}

describe('ChatsTab', () => {
  let listener: ((e: ChangeEvent) => void) | null = null
  beforeEach(() => {
    vi.clearAllMocks()
    listener = null
    mocked.onChange.mockImplementation((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    })
  })
  afterEach(() => useTabs.setState({ openInSidepanel: realOpenInSidepanel }))

  test('test Chats filters by title and opens a chat in the side panel', async () => {
    const openInSidepanel = vi.fn()
    useTabs.setState({ openInSidepanel })
    mocked.agentChats.mockResolvedValue([
      chat(CHAT_B, 'Rack layout for room 2', { messageCount: 4 }),
      chat(CHAT_A, 'What do my notes say?', { messageCount: 1, spaceName: null }),
    ])
    const user = userEvent.setup()
    render(<ChatsTab agent={agent({ id: RESEARCHER })} />)
    const list = await screen.findByRole('list', { name: CHATS_TEXT.list })
    expect(mocked.agentChats).toHaveBeenCalledWith(RESEARCHER)
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-chat'))).toEqual([CHAT_B, CHAT_A])
    expect(rows[0]).toHaveTextContent('Rack layout for room 2')
    expect(rows[0]).toHaveTextContent('Notes')
    expect(rows[0]).toHaveTextContent('4 messages')
    expect(rows[1]).toHaveTextContent('1 message')

    // Under 2 characters the field filters titles (as in M17).
    await user.type(screen.getByRole('searchbox', { name: CHATS_TEXT.filter }), 'R')
    expect(within(list).getAllByRole('listitem').map((r) => r.getAttribute('data-chat'))).toEqual([CHAT_B])
    await user.click(within(list).getByRole('button', { name: /Rack layout/ }))
    expect(openInSidepanel).toHaveBeenCalledWith({ kind: 'aiChat', agentId: RESEARCHER, chatId: CHAT_B })

    await user.clear(screen.getByRole('searchbox', { name: CHATS_TEXT.filter }))
    await user.type(screen.getByRole('searchbox', { name: CHATS_TEXT.filter }), 'nothing like it')
    expect(await screen.findByText(CHATS_TEXT.noMatch)).toBeInTheDocument()
  })

  test('test searching shows hits with snippets as text', async () => {
    const openInSidepanel = vi.fn()
    useTabs.setState({ openInSidepanel })
    mocked.agentChats.mockResolvedValue([chat(CHAT_A, 'Room plan'), chat(CHAT_B, 'Other')])
    mocked.searchAgentChats.mockResolvedValue([
      {
        chatId: CHAT_A,
        title: 'Room plan',
        updatedAt: '2026-11-05T09:01:00.000Z',
        spaceName: 'Notes',
        snippets: ['…labels on the «rack» go <b>left</b>…', 'the «rack» in room 2'],
        matches: 2,
      },
    ])
    const user = userEvent.setup()
    render(<ChatsTab agent={agent({ id: RESEARCHER })} />)
    await screen.findByRole('list', { name: CHATS_TEXT.list })
    expect(screen.getByRole('searchbox', { name: 'Search chats' })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: CHATS_TEXT.filter }), 'rack')
    const hits = await screen.findByRole('list', { name: CHATS_TEXT.hits })
    // Debounced: one call for the whole word.
    expect(mocked.searchAgentChats).toHaveBeenCalledTimes(1)
    expect(mocked.searchAgentChats).toHaveBeenCalledWith(RESEARCHER, 'rack')
    const rows = within(hits).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-chat'))).toEqual([CHAT_A])
    const snippets = rows[0].querySelectorAll('[data-snippet]')
    expect(snippets).toHaveLength(2)
    // The marks are bold text; the snippet's own HTML stays text.
    const bold = snippets[0].querySelector('strong')
    expect(bold).toHaveTextContent('rack')
    expect(snippets[0].textContent).toBe('…labels on the rack go <b>left</b>…')
    expect(snippets[0].querySelector('b')).toBeNull()
    await user.click(within(hits).getByRole('button', { name: /Room plan/ }))
    expect(openInSidepanel).toHaveBeenCalledWith({ kind: 'aiChat', agentId: RESEARCHER, chatId: CHAT_A })
    expect(snippetPieces('a «b» c')).toEqual([
      { text: 'a ', match: false },
      { text: 'b', match: true },
      { text: ' c', match: false },
    ])
  })

  test('test short queries filter titles', async () => {
    mocked.agentChats.mockResolvedValue([chat(CHAT_A, 'Alpha'), chat(CHAT_B, 'Beta')])
    const user = userEvent.setup()
    render(<ChatsTab agent={agent({ id: RESEARCHER })} />)
    const list = await screen.findByRole('list', { name: CHATS_TEXT.list })
    await user.type(screen.getByRole('searchbox', { name: CHATS_TEXT.filter }), 'b')
    expect(within(list).getAllByRole('listitem').map((r) => r.getAttribute('data-chat'))).toEqual([CHAT_B])
    await new Promise((r) => setTimeout(r, 300))
    expect(mocked.searchAgentChats).not.toHaveBeenCalled()
  })

  test('test a delegated chat shows who delegated it', async () => {
    resetAgents()
    useAgents.setState({ agents: [agent({ id: 'assistant' }), agent({ id: RESEARCHER })], loaded: true })
    mocked.agentChats.mockResolvedValue([
      chat(CHAT_B, 'Find rack pages', { delegated: true, from: 'assistant' }),
      chat(CHAT_A, 'Asked by a gone agent', { delegated: true, from: '01JGONE0000000000000000000' }),
      chat('01JD0000000000000000000003', 'My own chat'),
    ])
    render(<ChatsTab agent={agent({ id: RESEARCHER })} />)
    const list = await screen.findByRole('list', { name: CHATS_TEXT.list })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0].querySelector('[data-delegated]')).toHaveTextContent('Delegated by Assistant')
    expect(rows[1].querySelector('[data-delegated]')).toHaveTextContent('Delegated by another agent')
    expect(rows[2].querySelector('[data-delegated]')).toBeNull()
    expect(delegatedLine({ delegated: true, from: null }, [])).toBe('Delegated by another agent')
    expect(delegatedLine({ delegated: false, from: null }, [])).toBeNull()
    resetAgents()
  })

  test('test the list reloads on agentChats events for this agent', async () => {
    mocked.agentChats.mockResolvedValueOnce([])
    render(<ChatsTab agent={agent({ id: RESEARCHER })} />)
    expect(await screen.findByText(CHATS_TEXT.empty)).toBeInTheDocument()
    mocked.agentChats.mockResolvedValue([chat(CHAT_A, 'A new chat')])
    // Another agent's chat: no reload.
    act(() => listener?.({ kind: 'agentChats', path: 'assistant', version: CHAT_A, origin: null }))
    expect(mocked.agentChats).toHaveBeenCalledTimes(1)
    act(() => listener?.({ kind: 'agentChats', path: RESEARCHER, version: CHAT_A, origin: null }))
    await waitFor(() => expect(screen.getByText('A new chat')).toBeInTheDocument())
  })
})
