import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo } from '@/api/types'
import { agent, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAgents } from '@/agents/useAgents'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import App from './App'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  resetAgents()
  vi.clearAllMocks()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.agents.mockResolvedValue([agent({ id: 'assistant' }), agent({ id: RESEARCHER })])
})

describe('M17 agent target', () => {
  test('test an agent target renders the agent page with its name as tab title', async () => {
    useTabs.getState().open({ kind: 'agent', id: RESEARCHER })
    render(<App />)
    const page = await waitFor(() => {
      const el = document.querySelector(`[data-agent-page="${RESEARCHER}"]`)
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(within(page).getByRole('heading', { name: 'Researcher' })).toBeInTheDocument()
    expect(within(page).getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
    const strip = screen.getByRole('tablist', { name: 'Tabs' })
    await waitFor(() => expect(within(strip).getByText('Researcher')).toBeInTheDocument())
    expect(within(strip).queryByText('Agent')).toBeNull()
  })
})
