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
import { CHATS_TEXT, ChatsTab } from './ChatsTab'

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

    await user.type(screen.getByRole('searchbox', { name: CHATS_TEXT.filter }), 'RACK')
    expect(within(list).getAllByRole('listitem').map((r) => r.getAttribute('data-chat'))).toEqual([CHAT_B])
    await user.click(within(list).getByRole('button', { name: /Rack layout/ }))
    expect(openInSidepanel).toHaveBeenCalledWith({ kind: 'aiChat', agentId: RESEARCHER, chatId: CHAT_B })

    await user.clear(screen.getByRole('searchbox', { name: CHATS_TEXT.filter }))
    await user.type(screen.getByRole('searchbox', { name: CHATS_TEXT.filter }), 'nothing like it')
    expect(screen.getByText(CHATS_TEXT.noMatch)).toBeInTheDocument()
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
