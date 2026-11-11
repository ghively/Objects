// M32: the Tasks entry opens the plain Tasks page (target `tasks`) and is active for it only. The
// Work page (the dashboard) has its own entry directly under Tasks, shown only while Work is on for
// the space (`useWorkOn`). While the space hides Tasks ("Hide Tasks in this space") neither shows.
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
import { setWorkOn } from '@/test/workOn'
import { readTasksTab, writeTasksTab } from '@/tasks/tasksTab'
import { Sidebar } from './Sidebar'

const mocked = vi.mocked(api)
const main = () => screen.getByRole('navigation', { name: 'Main' })
const tasksButton = () => within(main()).getByRole('button', { name: 'Tasks' })
const workButton = () => within(main()).queryByRole('button', { name: 'Work' })
const mainNames = () =>
  within(main())
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())

describe('Sidebar Tasks and Work entries (M32)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
    resetSpaceInfo()
    useSettings.setState({ settings: { ...settingsDefaults } })
    mocked.agents.mockResolvedValue([agent({ id: 'assistant', exists: false })])
    // Work off unless a test turns it on.
    mocked.space.mockResolvedValue({ name: 'space', root: '/space', types: [], workEnabled: null, workOn: false })
  })

  test('test there is no Work entry while Work is off', async () => {
    render(<Sidebar types={[]} />)
    await waitFor(() => expect(useSpaceInfo.getState().space).not.toBeNull())
    expect(workButton()).toBeNull()
    expect(mainNames().slice(0, 4)).toEqual(['All notes', 'Calendar', 'Tasks', 'Graph'])
  })

  test('test Work shows directly under Tasks while Work is on, and opens the work target', async () => {
    mocked.space.mockResolvedValue({ name: 'space', root: '/space', types: [], workEnabled: true, workOn: true })
    const onOpenTarget = vi.fn()
    const user = userEvent.setup()
    render(<Sidebar types={[]} onOpenTarget={onOpenTarget} />)
    await waitFor(() => expect(workButton()).not.toBeNull())
    expect(mainNames().slice(0, 5)).toEqual(['All notes', 'Calendar', 'Tasks', 'Work', 'Graph'])
    await user.click(workButton()!)
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'work' }, { newTab: false })
    await user.keyboard('{Control>}')
    await user.click(workButton()!)
    await user.keyboard('{/Control}')
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'work' }, { newTab: true })
  })

  test('test the Work entry follows the switch without a reload', async () => {
    render(<Sidebar types={[]} />)
    await waitFor(() => expect(useSpaceInfo.getState().space).not.toBeNull())
    expect(workButton()).toBeNull()
    setWorkOn(true)
    await waitFor(() => expect(workButton()).not.toBeNull())
    setWorkOn(false)
    await waitFor(() => expect(workButton()).toBeNull())
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

  test('test aria-current marks Tasks for the tasks target only, Work for the work target', async () => {
    mocked.space.mockResolvedValue({ name: 'space', root: '/space', types: [], workEnabled: true, workOn: true })
    const { rerender } = render(<Sidebar types={[]} />)
    await waitFor(() => expect(workButton()).not.toBeNull())
    expect(tasksButton()).not.toHaveAttribute('aria-current')
    expect(workButton()).not.toHaveAttribute('aria-current')
    rerender(<Sidebar types={[]} workActive />)
    expect(tasksButton()).not.toHaveAttribute('aria-current')
    expect(workButton()).toHaveAttribute('aria-current', 'page')
    rerender(<Sidebar types={[]} tasksActive />)
    expect(tasksButton()).toHaveAttribute('aria-current', 'page')
    expect(workButton()).not.toHaveAttribute('aria-current')
  })

  test('test while the space hides Tasks there is no Tasks entry and no Work entry, even with Work on', async () => {
    mocked.space.mockResolvedValue({
      name: 'space',
      root: '/space',
      types: [],
      icon: null,
      description: null,
      hideTaskManagement: true,
      workEnabled: true,
      workOn: true,
      revision: 's1',
    })
    render(<Sidebar types={[]} />)
    await waitFor(() => expect(useSpaceInfo.getState().space?.hideTaskManagement).toBe(true))
    expect(within(main()).queryByRole('button', { name: 'Tasks' })).toBeNull()
    // The setting hides Tasks, not Work: the Work entry stays where it is (the fix pass, F12).
    expect(workButton()).not.toBeNull()
    // The rest of the main entries are untouched (decision 1: AI stays where it is).
    expect(mainNames().slice(0, 4)).toEqual(['All notes', 'Calendar', 'Work', 'Graph'])
    // The switch off again: Tasks is back, without a reload.
    act(() => useSpaceInfo.setState((st) => ({ space: st.space && { ...st.space, hideTaskManagement: false } })))
    expect(mainNames().slice(0, 5)).toEqual(['All notes', 'Calendar', 'Tasks', 'Work', 'Graph'])
  })

  // The walk's W14: the Tasks entry opens the page on Today, not on the list used last.
  test('test the Tasks entry asks for Today: the list remembered for the space is let go', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    render(<Sidebar types={[]} onOpenTarget={onOpenTarget} />)
    await waitFor(() => expect(useSpaceInfo.getState().space).not.toBeNull())
    const root = useSpaceInfo.getState().space!.root
    writeTasksTab(root, 'inbox')
    expect(readTasksTab(root)).toBe('inbox')
    await user.click(tasksButton()!)
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'tasks' }, { newTab: false })
    expect(readTasksTab(root)).toBeNull()
  })

  test('test Tasks shows while AI features are hidden', () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    render(<Sidebar types={[]} />)
    expect(tasksButton()).toBeInTheDocument()
  })
})
