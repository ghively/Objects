import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import type { AgentTrashItem } from '@/api/types'
import { AgentTrashDialog } from './AgentTrashDialog'
import { resetAgents } from './useAgents'

const mocked = vi.mocked(api)

const ITEMS: AgentTrashItem[] = [
  {
    trashId: 'agent-trash-2',
    agentId: '01JC7ZK3T9Q4M2X8B5N6R1V0WF',
    name: 'Writer',
    icon: 'ph-pen',
    originalPath: '/state/agents/Writer',
    deletedAt: '2026-11-05T11:00:00.000Z',
  },
  {
    trashId: 'agent-trash-1',
    agentId: '01JC7ZK3T9Q4M2X8B5N6R1V0WE',
    name: 'Researcher',
    icon: 'ph-robot',
    originalPath: '/state/agents/Researcher',
    deletedAt: '2026-11-05T10:00:00.000Z',
  },
]

describe('AgentTrashDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
  })

  test('test lists the deleted agents in the served order', async () => {
    mocked.agentTrash.mockResolvedValueOnce(ITEMS)
    render(<AgentTrashDialog open onOpenChange={() => undefined} />)
    const list = await screen.findByRole('list', { name: 'Deleted agents' })
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-agent-trash'))).toEqual([
      'agent-trash-2',
      'agent-trash-1',
    ])
    expect(within(list).getByText('Researcher')).toBeInTheDocument()
  })

  test('test an empty trash says so', async () => {
    render(<AgentTrashDialog open onOpenChange={() => undefined} />)
    expect(await screen.findByText('No deleted agents.')).toBeInTheDocument()
  })

  test('test a 409 on restore shows the server message', async () => {
    mocked.agentTrash.mockResolvedValueOnce(ITEMS)
    mocked.restoreAgent.mockRejectedValueOnce(new ApiError(409, 'An agent with this id is already listed.'))
    const user = userEvent.setup()
    render(<AgentTrashDialog open onOpenChange={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: 'Restore Researcher' }))
    expect(mocked.restoreAgent).toHaveBeenCalledWith('agent-trash-1')
    expect(await screen.findByRole('alert')).toHaveTextContent('An agent with this id is already listed.')
  })
})
