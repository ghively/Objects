// Gene's redesign: M23's Work entry is gone from the sidebar. M32 contract: the Tasks entry opens
// the plain Tasks page (target `tasks`) and, until the sidebar has its own Work entry (lane B),
// is active on the `work` target too. It stays while the space hides task management.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAgents } from '@/agents/useAgents'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
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

  test('test Tasks opens the Tasks page, Ctrl+click in a new tab', async () => {
    const onOpenTarget = vi.fn()
    const user = userEvent.setup()
    render(<Sidebar types={[]} onOpenTarget={onOpenTarget} />)
    await user.click(tasksButton())
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'tasks' }, { newTab: false })
    await user.keyboard('{Control>}')
    await user.click(tasksButton())
    await user.keyboard('{/Control}')
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'tasks' }, { newTab: true })
  })

  test('test aria-current marks Tasks on the dashboard and on the old tasks target', () => {
    const { rerender } = render(<Sidebar types={[]} />)
    expect(tasksButton()).not.toHaveAttribute('aria-current')
    rerender(<Sidebar types={[]} workActive />)
    expect(tasksButton()).toHaveAttribute('aria-current', 'page')
    rerender(<Sidebar types={[]} tasksActive />)
    expect(tasksButton()).toHaveAttribute('aria-current', 'page')
  })

  test('test Tasks stays, and opens the Tasks page, while the space hides task management', async () => {
    resetSpaceInfo()
    mocked.space.mockResolvedValueOnce({
      name: 'space',
      root: '/space',
      types: [],
      icon: null,
      description: null,
      hideTaskManagement: true,
      revision: 's1',
    })
    const onOpenTarget = vi.fn()
    const user = userEvent.setup()
    try {
      render(<Sidebar types={[]} onOpenTarget={onOpenTarget} />)
      await waitFor(() => expect(useSpaceInfo.getState().space?.hideTaskManagement).toBe(true))
      await user.click(tasksButton())
      expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'tasks' }, { newTab: false })
      expect(screen.queryByRole('button', { name: 'Work' })).toBeNull()
    } finally {
      resetSpaceInfo()
    }
  })

  test('test Tasks shows while AI features are hidden', () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    render(<Sidebar types={[]} />)
    expect(tasksButton()).toBeInTheDocument()
  })
})
