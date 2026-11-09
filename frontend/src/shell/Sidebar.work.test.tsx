// M23 Task 17: the Work entry in the sidebar, directly below the Agents section.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { AGENT_TEXT } from '@/agents/agentText'
import { resetAgents } from '@/agents/useAgents'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { agent } from '@/test/mockApi'
import { Sidebar, WORK_LABEL } from './Sidebar'

const mocked = vi.mocked(api)

describe('Sidebar Work entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
    useSettings.setState({ settings: { ...settingsDefaults } })
    mocked.agents.mockResolvedValue([agent({ id: 'assistant', exists: false })])
  })

  test('test Work sits below the Agents section, after the main navigation', async () => {
    render(<Sidebar types={[]} />)
    const main = screen.getByRole('navigation', { name: 'Main' })
    const agents = await screen.findByRole('region', { name: AGENT_TEXT.heading })
    const work = screen.getByRole('navigation', { name: 'Work' })
    // Order: the main navigation, then the agents, then Work (the agent loop's dashboard).
    expect(main.compareDocumentPosition(agents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(agents.nextElementSibling).toBe(work)
    const button = screen.getByRole('button', { name: WORK_LABEL })
    expect(button.querySelector('[data-icon="ph-briefcase"]')).not.toBeNull()
  })

  test('test Work opens the work target, Ctrl+click in a new tab', async () => {
    const onOpenTarget = vi.fn()
    const user = userEvent.setup()
    render(<Sidebar types={[]} onOpenTarget={onOpenTarget} />)
    await user.click(screen.getByRole('button', { name: WORK_LABEL }))
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'work' }, { newTab: false })
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('button', { name: WORK_LABEL }))
    await user.keyboard('{/Control}')
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'work' }, { newTab: true })
  })

  test('test aria-current marks Work while it is active', () => {
    const { rerender } = render(<Sidebar types={[]} />)
    expect(screen.getByRole('button', { name: WORK_LABEL })).not.toHaveAttribute('aria-current')
    rerender(<Sidebar types={[]} workActive />)
    expect(screen.getByRole('button', { name: WORK_LABEL })).toHaveAttribute('aria-current', 'page')
  })

  test('test Work shows while AI features are hidden', () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    render(<Sidebar types={[]} />)
    expect(screen.queryByRole('region', { name: AGENT_TEXT.heading })).toBeNull()
    expect(screen.getByRole('button', { name: WORK_LABEL })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' }).nextElementSibling).toBe(
      screen.getByRole('navigation', { name: 'Work' }),
    )
  })
})
