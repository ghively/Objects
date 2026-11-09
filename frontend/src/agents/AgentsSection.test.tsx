import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useTabs } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { Sidebar } from '@/shell/Sidebar'
import { agent, remoteAgent } from '@/test/mockApi'
import { AgentsSection } from './AgentsSection'
import { AGENT_TEXT } from './agentText'
import { resetAgents } from './useAgents'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
const realOpenInSidepanel = useTabs.getState().openInSidepanel

describe('AgentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
    useSettings.setState({ settings: { ...settingsDefaults } })
    mocked.agents.mockResolvedValue([agent({ id: 'assistant', exists: false }), agent({ id: RESEARCHER })])
  })

  afterEach(() => {
    useTabs.setState({ openInSidepanel: realOpenInSidepanel })
    resetAgents()
  })

  test('test the section sits below the main navigation and lists the default agent first', async () => {
    render(<Sidebar types={[]} />)
    const section = await screen.findByRole('region', { name: AGENT_TEXT.heading })
    const nav = screen.getByRole('navigation', { name: 'Main' })
    // Directly below the main navigation; the next element after the section is the Work entry.
    expect(nav.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(section.nextElementSibling).toBe(screen.getByRole('navigation', { name: 'Work' }))
    await waitFor(() => expect(section.querySelectorAll('[data-agent]')).toHaveLength(2))
    const rows = [...section.querySelectorAll('[data-agent]')].map((r) => r.getAttribute('data-agent'))
    expect(rows).toEqual(['assistant', RESEARCHER])
    expect(within(section).getByRole('button', { name: 'Assistant' })).toBeInTheDocument()
    // "+ New agent" is the last row.
    const items = within(within(section).getByRole('list', { name: AGENT_TEXT.heading })).getAllByRole('listitem')
    expect(items.at(-1)?.querySelector('[data-new-agent-row]')).not.toBeNull()
  })

  test('test the section is hidden while AI features are hidden', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    render(<Sidebar types={[]} />)
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: AGENT_TEXT.heading })).toBeNull()
    expect(mocked.agents).not.toHaveBeenCalled()
  })

  test('test clicking an agent opens its chat', async () => {
    const openInSidepanel = vi.fn()
    useTabs.setState({ openInSidepanel })
    const user = userEvent.setup()
    render(<AgentsSection />)
    await user.click(await screen.findByRole('button', { name: 'Researcher' }))
    expect(openInSidepanel).toHaveBeenCalledWith({ kind: 'aiChat', agentId: RESEARCHER })
    await user.click(screen.getByRole('button', { name: 'Assistant' }))
    expect(openInSidepanel).toHaveBeenLastCalledWith({ kind: 'aiChat', agentId: 'assistant' })
  })

  test('test the row menu items', async () => {
    const onOpenTarget = vi.fn()
    const user = userEvent.setup()
    render(<AgentsSection onOpenTarget={onOpenTarget} />)
    await user.click(await screen.findByRole('button', { name: AGENT_TEXT.rowMenu('Researcher') }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Open chat',
      'Settings',
      'Memory & skills',
      'Duplicate',
      'Delete',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Settings' }))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'agent', id: RESEARCHER }, {})
  })

  test('test the row menu has Memory & skills after Settings and it opens the memory tab', async () => {
    const onOpenTarget = vi.fn()
    const user = userEvent.setup()
    render(<AgentsSection onOpenTarget={onOpenTarget} />)
    await user.click(await screen.findByRole('button', { name: AGENT_TEXT.rowMenu('Researcher') }))
    const menu = await screen.findByRole('menu')
    const labels = within(menu).getAllByRole('menuitem').map((i) => i.textContent)
    expect(labels.indexOf('Memory & skills')).toBe(labels.indexOf('Settings') + 1)
    await user.click(within(menu).getByRole('menuitem', { name: 'Memory & skills' }))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'agent', id: RESEARCHER, tab: 'memory' }, {})
  })

  test('test the default agent cannot be deleted from its menu', async () => {
    const user = userEvent.setup()
    render(<AgentsSection />)
    await user.click(await screen.findByRole('button', { name: AGENT_TEXT.rowMenu('Assistant') }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-disabled')
  })

  test('test Delete of an outside agent shows the left-in-place notice', async () => {
    mocked.deleteAgent.mockResolvedValue({ trashId: null })
    const user = userEvent.setup()
    render(<AgentsSection />)
    await user.click(await screen.findByRole('button', { name: AGENT_TEXT.rowMenu('Researcher') }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
    expect(mocked.deleteAgent).toHaveBeenCalledWith(RESEARCHER)
    expect(await screen.findByRole('status')).toHaveTextContent('Removed from the list. Its folder was left where it is.')
  })

  test('test Delete into the agent trash shows no notice', async () => {
    mocked.deleteAgent.mockResolvedValue({ trashId: 'agent-trash-1' })
    const user = userEvent.setup()
    render(<AgentsSection />)
    await user.click(await screen.findByRole('button', { name: AGENT_TEXT.rowMenu('Researcher') }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(mocked.agents).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('test the + menu holds New agent, Add agent folder, Add remote agent and Deleted agents', async () => {
    const user = userEvent.setup()
    render(<AgentsSection />)
    await user.click(screen.getByRole('button', { name: AGENT_TEXT.addMenu }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'New agent',
      'Add agent folder…',
      'Add remote agent…',
      'Deleted agents…',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Add remote agent…' }))
    expect(await screen.findByRole('dialog', { name: 'Add remote agent' })).toBeInTheDocument()
  })

  test('test a remote agent row shows the remote mark and its three menu items', async () => {
    const PLANNER = '01JREMOTE00000000000000001'
    mocked.agents.mockResolvedValue([agent({ id: 'assistant' }), agent({ id: RESEARCHER }), remoteAgent({ id: PLANNER })])
    mocked.deleteAgent.mockResolvedValue({ trashId: 'agent-trash-2' })
    const onOpenTarget = vi.fn()
    const openInSidepanel = vi.fn()
    useTabs.setState({ openInSidepanel })
    const user = userEvent.setup()
    render(<AgentsSection onOpenTarget={onOpenTarget} />)
    const row = await waitFor(() => {
      const r = document.querySelector(`[data-agent="${PLANNER}"]`)
      expect(r).not.toBeNull()
      return r as HTMLElement
    })
    expect(row).toHaveTextContent('Fake Planner')
    expect(within(row).getByLabelText('Remote agent')).toHaveTextContent('remote')
    // A local row has no mark.
    expect(within(document.querySelector(`[data-agent="${RESEARCHER}"]`) as HTMLElement).queryByLabelText('Remote agent')).toBeNull()

    await user.click(within(row).getByRole('button', { name: AGENT_TEXT.rowMenu('Fake Planner') }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open chat', 'Settings', 'Delete'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Open chat' }))
    expect(openInSidepanel).toHaveBeenCalledWith({ kind: 'aiChat', agentId: PLANNER })

    await user.click(within(row).getByRole('button', { name: AGENT_TEXT.rowMenu('Fake Planner') }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Settings' }))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'agent', id: PLANNER }, {})

    // Delete: into the agent trash, no confirm, no notice.
    await user.click(within(row).getByRole('button', { name: AGENT_TEXT.rowMenu('Fake Planner') }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
    expect(mocked.deleteAgent).toHaveBeenCalledWith(PLANNER)
    await waitFor(() => expect(mocked.agents).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('test Deleted agents restores', async () => {
    mocked.agentTrash.mockResolvedValueOnce([
      {
        trashId: 'agent-trash-1',
        agentId: RESEARCHER,
        name: 'Researcher',
        icon: 'ph-robot',
        originalPath: '/state/agents/Researcher',
        deletedAt: '2026-11-05T10:00:00.000Z',
      },
    ])
    const user = userEvent.setup()
    render(<AgentsSection />)
    await user.click(screen.getByRole('button', { name: AGENT_TEXT.addMenu }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Deleted agents…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deleted agents' })
    await user.click(await within(dialog).findByRole('button', { name: 'Restore Researcher' }))
    expect(mocked.restoreAgent).toHaveBeenCalledWith('agent-trash-1')
    expect(await within(dialog).findByText('No deleted agents.')).toBeInTheDocument()
    await waitFor(() => expect(mocked.agents).toHaveBeenCalledTimes(2))
  })

  test('test Add agent folder shows the server\'s 422 message', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/api/client')>('@/api/client')
    mocked.addAgentFolder.mockRejectedValueOnce(new ApiError(422, "This folder isn't an Object agent."))
    const user = userEvent.setup()
    render(<AgentsSection />)
    await user.click(screen.getByRole('button', { name: AGENT_TEXT.addMenu }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Add agent folder…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add agent folder' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Folder path' }), 'D:\\Shared\\Helper')
    await user.click(within(dialog).getByRole('button', { name: 'Add folder' }))
    expect(mocked.addAgentFolder).toHaveBeenCalledWith('D:\\Shared\\Helper')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("This folder isn't an Object agent.")
    expect(screen.getByRole('dialog', { name: 'Add agent folder' })).toBeInTheDocument()
  })

  test('test Add agent folder lists the agent and closes', async () => {
    const user = userEvent.setup()
    render(<AgentsSection />)
    await user.click(screen.getByRole('button', { name: AGENT_TEXT.addMenu }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Add agent folder…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add agent folder' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Folder path' }), 'D:\\Shared\\Helper')
    await user.click(within(dialog).getByRole('button', { name: 'Add folder' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add agent folder' })).toBeNull())
    expect(mocked.agents).toHaveBeenCalledTimes(2)
  })
})
