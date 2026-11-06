import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import type { ToolGroup } from '@/api/types'
import { agent } from '@/test/mockApi'
import { NewAgentDialog } from './NewAgentDialog'
import { resetAgents, useAgents } from './useAgents'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
const WARNING = 'With the shell on, this agent can read every file on this computer, including pages excluded from AI.'

const DEFAULTS: ToolGroup[] = [
  {
    id: 'object-write',
    label: 'Object write',
    tools: [{ id: 'mcp__object__write_body', label: 'write_body', on: true, warning: null }],
  },
  {
    id: 'builtin',
    label: 'Claude Code built-ins',
    tools: [
      { id: 'Bash', label: 'Shell (Bash, PowerShell)', on: false, warning: WARNING },
      { id: 'Read', label: 'Read files', on: true, warning: null },
    ],
  },
]

describe('NewAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
    mocked.agentToolDefaults.mockResolvedValue(DEFAULTS)
    mocked.agents.mockResolvedValue([
      agent({ id: 'assistant' }),
      agent({ id: RESEARCHER, description: 'Digs', model: 'opus', toolsOff: ['Bash', 'Read'] }),
    ])
  })

  test('test New agent creates with defaults', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<NewAgentDialog open onOpenChange={onOpenChange} />)
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    // The catalogue's defaults: the shell is off.
    expect(await within(dialog).findByRole('switch', { name: 'Shell (Bash, PowerShell)' })).not.toBeChecked()
    expect(within(dialog).getByRole('radio', { name: "Inside Object's agents folder" })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: 'Blank' })).toBeChecked()
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Writer')
    await user.type(within(dialog).getByRole('textbox', { name: 'Instructions' }), 'Write plainly.')
    await user.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(mocked.createAgent).toHaveBeenCalledTimes(1))
    expect(mocked.createAgent).toHaveBeenCalledWith({
      agent: { name: 'Writer', icon: 'ph-robot', description: '', model: null, toolsOff: ['Bash'] },
      instructions: 'Write plainly.',
      location: null,
      duplicateOf: null,
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mocked.agents).toHaveBeenCalled()
  })

  test('test a chosen folder sends its path', async () => {
    const user = userEvent.setup()
    render(<NewAgentDialog open onOpenChange={() => undefined} />)
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    await within(dialog).findByRole('switch', { name: 'Read files' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Writer')
    await user.click(within(dialog).getByRole('radio', { name: 'Choose a folder' }))
    expect(within(dialog).getByRole('button', { name: 'Create agent' })).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox', { name: 'Folder path' }), 'D:\\Agents')
    await user.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(mocked.createAgent).toHaveBeenCalledWith(expect.objectContaining({ location: 'D:\\Agents' })))
  })

  test('test Duplicate sends duplicateOf with the memory and skills choices', async () => {
    await useAgents.getState().load()
    const source = useAgents.getState().byId(RESEARCHER)!
    const user = userEvent.setup()
    render(<NewAgentDialog open onOpenChange={() => undefined} duplicateOf={source} />)
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    expect(within(dialog).getByRole('radio', { name: 'Duplicate of…' })).toBeChecked()
    expect(within(dialog).getByRole('combobox', { name: 'Agent to duplicate' })).toHaveValue(RESEARCHER)
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Researcher copy')
    // The soul is copied by the server: no Instructions field.
    expect(within(dialog).queryByRole('textbox', { name: 'Instructions' })).toBeNull()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Copy memory' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(mocked.createAgent).toHaveBeenCalledTimes(1))
    expect(mocked.createAgent).toHaveBeenCalledWith({
      agent: { name: 'Researcher copy', icon: 'ph-robot', description: 'Digs', model: 'opus', toolsOff: ['Bash', 'Read'] },
      instructions: '',
      location: null,
      duplicateOf: { id: RESEARCHER, memory: true, skills: false },
    })
  })

  test('test Start from Duplicate of picks an agent and shows the copy choices', async () => {
    await useAgents.getState().load()
    const user = userEvent.setup()
    render(<NewAgentDialog open onOpenChange={() => undefined} />)
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    expect(within(dialog).queryByRole('checkbox', { name: 'Copy skills' })).toBeNull()
    await user.click(within(dialog).getByRole('radio', { name: 'Duplicate of…' }))
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Agent to duplicate' }), RESEARCHER)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Copy skills' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() =>
      expect(mocked.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ duplicateOf: { id: RESEARCHER, memory: false, skills: true } }),
      ),
    )
  })

  test('test a 422 shows its detail and keeps the dialog open', async () => {
    mocked.createAgent.mockRejectedValueOnce(new ApiError(422, "An agent folder can't be inside a space folder or hold one."))
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<NewAgentDialog open onOpenChange={onOpenChange} />)
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Writer')
    await user.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("An agent folder can't be inside a space folder or hold one.")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('test a 409 shows its detail', async () => {
    mocked.createAgent.mockRejectedValueOnce(new ApiError(409, 'A folder with that name already exists here.'))
    const user = userEvent.setup()
    render(<NewAgentDialog open onOpenChange={() => undefined} />)
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Writer')
    await user.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A folder with that name already exists here.')
  })

  test('test Cancel closes without creating', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<NewAgentDialog open onOpenChange={onOpenChange} />)
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocked.createAgent).not.toHaveBeenCalled()
  })
})
