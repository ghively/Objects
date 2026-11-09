// Gene's redesign: M23's Work entry is gone from the sidebar; the Tasks entry opens the Tasks
// dashboard (M23's Work page and the task lists as one page) and is active on either target.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAgents } from '@/agents/useAgents'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { agent } from '@/test/mockApi'
import { Sidebar } from './Sidebar'

const mocked = vi.mocked(api)
const tasksButton = () => within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tasks' })

describe('Sidebar Tasks entry (the Tasks dashboard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
    useSettings.setState({ settings: { ...settingsDefaults } })
    mocked.agents.mockResolvedValue([agent({ id: 'assistant', exists: false })])
  })

  test('test there is no separate Work entry', () => {
    render(<Sidebar types={[]} />)
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Work' })).toBeNull()
  })

  test('test Tasks opens the dashboard, Ctrl+click in a new tab', async () => {
    const onOpenTarget = vi.fn()
    const user = userEvent.setup()
    render(<Sidebar types={[]} onOpenTarget={onOpenTarget} />)
    await user.click(tasksButton())
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'work' }, { newTab: false })
    await user.keyboard('{Control>}')
    await user.click(tasksButton())
    await user.keyboard('{/Control}')
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'work' }, { newTab: true })
  })

  test('test aria-current marks Tasks on the dashboard and on the old tasks target', () => {
    const { rerender } = render(<Sidebar types={[]} />)
    expect(tasksButton()).not.toHaveAttribute('aria-current')
    rerender(<Sidebar types={[]} workActive />)
    expect(tasksButton()).toHaveAttribute('aria-current', 'page')
    rerender(<Sidebar types={[]} tasksActive />)
    expect(tasksButton()).toHaveAttribute('aria-current', 'page')
  })

  test('test Tasks shows while AI features are hidden', () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    render(<Sidebar types={[]} />)
    expect(tasksButton()).toBeInTheDocument()
  })
})
