import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import { useTabs } from '@/nav/tabs'
import { remoteAgent, remotePreview } from '@/test/mockApi'
import { AddRemoteAgentDialog } from './AddRemoteAgentDialog'
import { REMOTE_TEXT } from './agentText'
import { resetAgents, useAgents } from './useAgents'

const mocked = vi.mocked(api)
const realOpen = useTabs.getState().open

/** The dialog with its own open state and a button to open it again. */
function Host() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <AddRemoteAgentDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function dialog() {
  return screen.getByRole('dialog', { name: REMOTE_TEXT.addTitle })
}

describe('AddRemoteAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
  })
  afterEach(() => {
    useTabs.setState({ open: realOpen })
    resetAgents()
  })

  test('test Add remote agent looks up the card and shows its skills and endpoint', async () => {
    const open = vi.fn()
    useTabs.setState({ open })
    mocked.agents.mockResolvedValue([remoteAgent({ id: '01JNEWREMOTE00000000000000' })])
    const user = userEvent.setup()
    render(<Host />)
    const d = dialog()
    const url = within(d).getByRole('textbox', { name: REMOTE_TEXT.url })
    expect(url).toHaveAttribute('placeholder', 'https://agents.example.com')
    expect(within(d).getByRole('button', { name: REMOTE_TEXT.addButton })).toBeDisabled()
    await user.type(url, 'http://127.0.0.1:8799')
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.lookUp }))
    expect(mocked.previewRemoteAgent).toHaveBeenCalledWith('http://127.0.0.1:8799', { kind: 'none' })
    const preview = await waitFor(() => {
      const p = d.querySelector('[data-remote-preview]')
      expect(p).not.toBeNull()
      return p as HTMLElement
    })
    expect(preview).toHaveTextContent('Fake Planner')
    expect(preview).toHaveTextContent("A synthetic agent for Object's tests.")
    expect(preview).toHaveTextContent('Fake Org')
    expect(preview).toHaveTextContent('1.0.0')
    const skills = within(preview).getByRole('list', { name: REMOTE_TEXT.skills })
    expect(within(skills).getByRole('listitem')).toHaveTextContent('Plan a trip')
    expect(within(skills).getByRole('listitem')).toHaveTextContent('Plans a short trip.')
    expect(within(skills).getByRole('listitem')).toHaveTextContent('travel')
    expect(preview).toHaveTextContent('Sends messages to 127.0.0.1')
    expect(preview).toHaveTextContent('Streaming')
    expect(within(d).getByRole('textbox', { name: REMOTE_TEXT.name })).toHaveValue('Fake Planner')

    // The card's name is used unless Name was edited.
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.addButton }))
    expect(mocked.addRemoteAgent).toHaveBeenCalledWith({ url: 'http://127.0.0.1:8799', auth: { kind: 'none' }, name: null })
    await waitFor(() => expect(open).toHaveBeenCalledWith({ kind: 'agent', id: '01JNEWREMOTE00000000000000' }, {}))
    expect(useAgents.getState().agents.map((a) => a.id)).toEqual(['01JNEWREMOTE00000000000000'])
    expect(screen.queryByRole('dialog', { name: REMOTE_TEXT.addTitle })).toBeNull()
  })

  test('test an edited Name is sent', async () => {
    useTabs.setState({ open: vi.fn() })
    mocked.previewRemoteAgent.mockResolvedValueOnce(remotePreview({ card: { ...remotePreview().card, streaming: false } }))
    const user = userEvent.setup()
    render(<Host />)
    const d = dialog()
    await user.type(within(d).getByRole('textbox', { name: REMOTE_TEXT.url }), 'agents.example.com')
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.lookUp }))
    expect(await within(d).findByText(REMOTE_TEXT.noStreaming)).toBeInTheDocument()
    const name = within(d).getByRole('textbox', { name: REMOTE_TEXT.name })
    await user.clear(name)
    await user.type(name, 'Trips')
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.addButton }))
    expect(mocked.addRemoteAgent).toHaveBeenCalledWith({ url: 'agents.example.com', auth: { kind: 'none' }, name: 'Trips' })
  })

  test("test Add remote agent shows the server's 502 message", async () => {
    mocked.previewRemoteAgent.mockRejectedValueOnce(new ApiError(502, "Couldn't reach agents.example.com: connection refused"))
    const user = userEvent.setup()
    render(<Host />)
    const d = dialog()
    await user.type(within(d).getByRole('textbox', { name: REMOTE_TEXT.url }), 'https://agents.example.com')
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.lookUp }))
    expect(await within(d).findByRole('alert')).toHaveTextContent("Couldn't reach agents.example.com: connection refused")
    expect(within(d).getByRole('button', { name: REMOTE_TEXT.addButton })).toBeDisabled()

    // A 422 from Add shows the same way and keeps the dialog open.
    mocked.addRemoteAgent.mockRejectedValueOnce(new ApiError(409, 'This agent is already listed as Fake Planner.'))
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.lookUp }))
    await user.click(await within(d).findByRole('button', { name: REMOTE_TEXT.addButton }))
    expect(await within(d).findByRole('alert')).toHaveTextContent('This agent is already listed as Fake Planner.')
    expect(dialog()).toBeInTheDocument()
  })

  test('test Add remote agent sends the bearer and clears it on close', async () => {
    useTabs.setState({ open: vi.fn() })
    const user = userEvent.setup()
    render(<Host />)
    let d = dialog()
    await user.type(within(d).getByRole('textbox', { name: REMOTE_TEXT.url }), 'http://127.0.0.1:8799')
    await user.click(within(d).getByRole('radio', { name: REMOTE_TEXT.authBearer }))
    // A bearer needs its token before Look up.
    expect(within(d).getByRole('button', { name: REMOTE_TEXT.lookUp })).toBeDisabled()
    const token = within(d).getByLabelText(REMOTE_TEXT.token)
    expect(token).toHaveAttribute('type', 'password')
    await user.type(token, 'test-token')
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.lookUp }))
    expect(mocked.previewRemoteAgent).toHaveBeenCalledWith('http://127.0.0.1:8799', { kind: 'bearer', value: 'test-token' })
    await user.click(await within(d).findByRole('button', { name: REMOTE_TEXT.addButton }))
    expect(mocked.addRemoteAgent).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:8799',
      auth: { kind: 'bearer', value: 'test-token' },
      name: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: REMOTE_TEXT.addTitle })).toBeNull())
    // Never kept in a store or localStorage.
    expect(JSON.stringify(useAgents.getState())).not.toContain('test-token')
    expect(JSON.stringify({ ...localStorage })).not.toContain('test-token')

    // Opened again: empty.
    await user.click(screen.getByRole('button', { name: 'reopen' }))
    d = dialog()
    expect(within(d).getByRole('textbox', { name: REMOTE_TEXT.url })).toHaveValue('')
    expect(within(d).getByRole('radio', { name: REMOTE_TEXT.authNone })).toBeChecked()
    await user.click(within(d).getByRole('radio', { name: REMOTE_TEXT.authBearer }))
    expect(within(d).getByLabelText(REMOTE_TEXT.token)).toHaveValue('')

    // Cancel closes and forgets the typed value too.
    await user.type(within(d).getByLabelText(REMOTE_TEXT.token), 'another')
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.cancel }))
    await user.click(screen.getByRole('button', { name: 'reopen' }))
    await user.click(within(dialog()).getByRole('radio', { name: REMOTE_TEXT.authBearer }))
    expect(within(dialog()).getByLabelText(REMOTE_TEXT.token)).toHaveValue('')
  })

  test('test a header auth sends its name and value', async () => {
    const user = userEvent.setup()
    render(<Host />)
    const d = dialog()
    await user.type(within(d).getByRole('textbox', { name: REMOTE_TEXT.url }), 'https://agents.example.com')
    await user.click(within(d).getByRole('radio', { name: REMOTE_TEXT.authHeader }))
    await user.type(within(d).getByRole('textbox', { name: REMOTE_TEXT.headerName }), 'X-Api-Key')
    expect(within(d).getByLabelText(REMOTE_TEXT.value)).toHaveAttribute('type', 'password')
    await user.type(within(d).getByLabelText(REMOTE_TEXT.value), 'k1')
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.lookUp }))
    expect(mocked.previewRemoteAgent).toHaveBeenCalledWith('https://agents.example.com', {
      kind: 'header',
      headerName: 'X-Api-Key',
      value: 'k1',
    })
  })

  test('test the warnings are shown', async () => {
    const warnings = [
      "This agent's card sends messages to other.example.com, not agents.example.com.",
      "This address isn't encrypted (http), so the token can be read on the network.",
    ]
    mocked.previewRemoteAgent.mockResolvedValueOnce(remotePreview({ endpointHost: 'other.example.com', warnings }))
    const user = userEvent.setup()
    render(<Host />)
    const d = dialog()
    await user.type(within(d).getByRole('textbox', { name: REMOTE_TEXT.url }), 'agents.example.com')
    await user.click(within(d).getByRole('button', { name: REMOTE_TEXT.lookUp }))
    await within(d).findByText('Sends messages to other.example.com')
    const shown = [...d.querySelectorAll('[data-warning]')].map((w) => w.textContent)
    expect(shown).toEqual(warnings)
    for (const w of d.querySelectorAll('[data-warning]')) expect(w.className).toContain('amber')
  })
})
