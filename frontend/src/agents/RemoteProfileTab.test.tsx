import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, RevisionConflictError } from '@/api/client'
import type { Agent } from '@/api/types'
import { remoteAgent } from '@/test/mockApi'
import { REMOTE_TEXT } from './agentText'
import { authStatus, RemoteProfileTab } from './RemoteProfileTab'
import { resetAgents, useAgents } from './useAgents'

const mocked = vi.mocked(api)
const PLANNER = '01JREMOTE00000000000000001'

function Live({ id }: { id: string }) {
  const a = useAgents((s) => s.agents.find((x) => x.id === id))
  return a ? <RemoteProfileTab agent={a} /> : null
}

function seed(...agents: Agent[]) {
  useAgents.setState({ agents, loaded: true })
}

function withAuth(auth: NonNullable<Agent['remote']>['auth'], partial: Partial<NonNullable<Agent['remote']>> = {}): Agent {
  const base = remoteAgent({ id: PLANNER })
  return remoteAgent({ id: PLANNER, remote: { ...base.remote!, auth, ...partial } })
}

describe('RemoteProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
  })
  afterEach(() => resetAgents())

  test('test the profile shows the card, auth, context and folder', () => {
    seed(remoteAgent({ id: PLANNER }))
    render(<Live id={PLANNER} />)
    expect(screen.getByRole('textbox', { name: REMOTE_TEXT.name })).toHaveValue('Fake Planner')
    const card = screen.getByRole('region', { name: REMOTE_TEXT.agentCard })
    const url = within(card).getByRole('textbox', { name: REMOTE_TEXT.cardUrl })
    expect(url).toHaveValue('http://127.0.0.1:8799/.well-known/agent-card.json')
    expect(url).toHaveAttribute('readonly')
    expect(card).toHaveTextContent('Sends messages to 127.0.0.1')
    expect(card).toHaveTextContent('A2A 1.0')
    expect(screen.getByRole('region', { name: REMOTE_TEXT.authentication })).toHaveTextContent('Bearer token: set')
    expect(screen.getByRole('region', { name: REMOTE_TEXT.contextSent })).toHaveTextContent('Not yet')
    expect(screen.getByText('/state/agents/Fake Planner')).toBeInTheDocument()
    // No model, description or tool fields of Object's.
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull()
  })

  test('test the auth status strings and the first-sent date', () => {
    expect(authStatus(withAuth({ kind: 'none', headerName: null, set: false }))).toBe('None')
    expect(authStatus(withAuth({ kind: 'bearer', headerName: null, set: true }))).toBe('Bearer token: set')
    expect(authStatus(withAuth({ kind: 'header', headerName: 'X-Api-Key', set: true }))).toBe('Header X-Api-Key: set')
    expect(authStatus(withAuth({ kind: 'bearer', headerName: null, set: false }))).toBe('Token: needed')
    seed(withAuth({ kind: 'bearer', headerName: null, set: true }, { contextNoticeAt: '2026-11-05T09:00:00.000Z' }))
    render(<Live id={PLANNER} />)
    expect(screen.getByRole('region', { name: REMOTE_TEXT.contextSent })).toHaveTextContent(/^Context sentFirst sent /)
  })

  test('test the name saves with the revision and a 409 reloads', async () => {
    seed(remoteAgent({ id: PLANNER, revision: 'r1' }))
    const user = userEvent.setup()
    render(<Live id={PLANNER} />)
    const name = screen.getByRole('textbox', { name: REMOTE_TEXT.name })
    await user.clear(name)
    await user.type(name, 'Trips{Enter}')
    await waitFor(() => expect(mocked.saveRemoteAgent).toHaveBeenCalledTimes(1))
    expect(mocked.saveRemoteAgent).toHaveBeenCalledWith(PLANNER, {
      name: 'Trips',
      icon: 'ph-globe',
      color: null,
      auth: null,
      baseRevision: 'r1',
    })
    await waitFor(() => expect(useAgents.getState().byId(PLANNER)?.revision).toBe('r1+1'))

    mocked.saveRemoteAgent.mockRejectedValueOnce(new RevisionConflictError('r9'))
    mocked.agent.mockResolvedValueOnce(remoteAgent({ id: PLANNER, name: 'Renamed elsewhere', revision: 'r9' }))
    await user.clear(name)
    await user.type(name, 'Mine{Enter}')
    expect(await screen.findByRole('status')).toHaveTextContent(REMOTE_TEXT.conflict)
    await waitFor(() => expect(name).toHaveValue('Renamed elsewhere'))
  })

  test('test Replace token saves the auth and shows set without the value', async () => {
    seed(withAuth({ kind: 'bearer', headerName: null, set: false }))
    mocked.saveRemoteAgent.mockImplementationOnce(async (id, req) =>
      remoteAgent({ id, name: req.name, revision: 'r2' }),
    )
    const user = userEvent.setup()
    render(<Live id={PLANNER} />)
    const section = screen.getByRole('region', { name: REMOTE_TEXT.authentication })
    expect(section).toHaveTextContent('Token: needed')
    await user.click(within(section).getByRole('button', { name: REMOTE_TEXT.replaceToken }))
    await user.click(within(section).getByRole('radio', { name: REMOTE_TEXT.authHeader }))
    await user.type(within(section).getByRole('textbox', { name: REMOTE_TEXT.headerName }), 'X-Api-Key')
    await user.type(within(section).getByLabelText(REMOTE_TEXT.value), 'new-secret')
    await user.click(within(section).getByRole('button', { name: REMOTE_TEXT.save }))
    expect(mocked.saveRemoteAgent).toHaveBeenCalledWith(PLANNER, {
      name: 'Fake Planner',
      icon: 'ph-globe',
      color: null,
      auth: { kind: 'header', headerName: 'X-Api-Key', value: 'new-secret' },
      baseRevision: 'r1',
    })
    await waitFor(() => expect(section).toHaveTextContent('Bearer token: set'))
    // The fields closed; the value is shown nowhere.
    expect(within(section).queryByLabelText(REMOTE_TEXT.value)).toBeNull()
    expect(document.body.innerHTML).not.toContain('new-secret')

    // Cancel closes without saving.
    await user.click(within(section).getByRole('button', { name: REMOTE_TEXT.replaceToken }))
    await user.click(within(section).getByRole('radio', { name: REMOTE_TEXT.authBearer }))
    await user.type(within(section).getByLabelText(REMOTE_TEXT.token), 'typed')
    await user.click(within(section).getByRole('button', { name: REMOTE_TEXT.cancel }))
    expect(mocked.saveRemoteAgent).toHaveBeenCalledTimes(1)
    expect(document.body.innerHTML).not.toContain('typed')
  })

  test('test Refresh card calls refreshRemoteAgent', async () => {
    seed(remoteAgent({ id: PLANNER }))
    const base = remoteAgent({ id: PLANNER })
    mocked.refreshRemoteAgent.mockResolvedValueOnce(
      remoteAgent({ id: PLANNER, remote: { ...base.remote!, endpointHost: 'agents.example.com' } }),
    )
    const user = userEvent.setup()
    render(<Live id={PLANNER} />)
    await user.click(screen.getByRole('button', { name: REMOTE_TEXT.refreshCard }))
    expect(mocked.refreshRemoteAgent).toHaveBeenCalledWith(PLANNER)
    expect(await screen.findByText('Sends messages to agents.example.com')).toBeInTheDocument()
  })

  test('test Open folder and Remove from list', async () => {
    seed(remoteAgent({ id: PLANNER }))
    const user = userEvent.setup()
    render(<Live id={PLANNER} />)
    await user.click(screen.getByRole('button', { name: REMOTE_TEXT.openFolder }))
    expect(mocked.revealAgentFolder).toHaveBeenCalledWith(PLANNER)
    await user.click(screen.getByRole('button', { name: REMOTE_TEXT.removeFromList }))
    expect(mocked.unregisterAgent).toHaveBeenCalledWith(PLANNER)
  })
})
