// M17: the chat header's agent picker.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAgents, useAgents } from '@/agents/useAgents'
import { agent, remoteAgent } from '@/test/mockApi'
import { AGENT_PICKER_TEXT as T, AgentPicker } from './AgentPicker'

const mocked = vi.mocked(api)
const RESEARCHER = '01JRESEARCHER0000000000000'

beforeEach(() => {
  vi.clearAllMocks()
  resetAgents()
})

describe('AgentPicker', () => {
  test('test the picker names the agent and lists every agent, the default first', async () => {
    useAgents.setState({ agents: [agent({ id: 'assistant' }), agent({ id: RESEARCHER })], loaded: true })
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AgentPicker value={RESEARCHER} onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: T.label })
    expect(trigger).toHaveTextContent('Researcher')
    await user.click(trigger)
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(['Assistant', 'Researcher'])
    expect(items[1]).toHaveAttribute('aria-checked', 'true')
    await user.click(items[0])
    expect(onChange).toHaveBeenCalledWith('assistant')
  })

  test('test picking the agent already shown changes nothing', async () => {
    useAgents.setState({ agents: [agent({ id: 'assistant' }), agent({ id: RESEARCHER })], loaded: true })
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AgentPicker value="assistant" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: T.label }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Assistant' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  test('test the list loads when it has not yet; the default agent is named meanwhile', async () => {
    render(<AgentPicker value="assistant" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: T.label })).toHaveTextContent(T.defaultName)
    await waitFor(() => expect(mocked.agents).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useAgents.getState().loaded).toBe(true))
  })

  test('test the agent picker marks remote agents', async () => {
    const PLANNER = '01JREMOTE00000000000000001'
    useAgents.setState({ agents: [agent({ id: 'assistant' }), agent({ id: RESEARCHER }), remoteAgent({ id: PLANNER })], loaded: true })
    const user = userEvent.setup()
    render(<AgentPicker value={PLANNER} onChange={() => {}} />)
    const trigger = screen.getByRole('button', { name: T.label })
    expect(trigger).toHaveTextContent('Fake Planner')
    expect(within(trigger).getByLabelText('Remote agent')).toHaveTextContent('remote')
    await user.click(trigger)
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((i) => i.querySelector('[data-remote-mark]') !== null)).toEqual([false, false, true])
    expect(items[2]).toHaveTextContent('Fake Planner')
  })

  test('test disabled', () => {
    useAgents.setState({ agents: [agent({ id: 'assistant' })], loaded: true })
    render(<AgentPicker value="assistant" onChange={() => {}} disabled />)
    expect(screen.getByRole('button', { name: T.label })).toBeDisabled()
  })
})
