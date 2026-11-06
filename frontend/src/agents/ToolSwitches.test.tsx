import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { McpGroupStatus, ToolGroup } from '@/api/types'
import { MCP_TEXT } from '@/mcp/mcpText'
import { AGENT_TEXT } from './agentText'
import { ToolSwitches } from './ToolSwitches'

const WARNING = 'With the shell on, this agent can read every file on this computer, including pages excluded from AI.'

const GROUPS: ToolGroup[] = [
  {
    id: 'object-write',
    label: 'Object write',
    tools: [
      { id: 'mcp__object__create_object', label: 'create_object', on: true, warning: null },
      { id: 'mcp__object__write_body', label: 'write_body', on: true, warning: null },
    ],
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

function Harness({ initial, onChange }: { initial: string[]; onChange(off: string[]): void }) {
  const [off, setOff] = useState(initial)
  return (
    <ToolSwitches
      groups={GROUPS}
      off={off}
      onChange={(next) => {
        setOff(next)
        onChange(next)
      }}
    />
  )
}

describe('ToolSwitches', () => {
  test('test rows show the off list', () => {
    render(<ToolSwitches groups={GROUPS} off={['Bash']} onChange={() => undefined} />)
    expect(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Read files' })).toBeChecked()
    expect(screen.getByRole('switch', { name: AGENT_TEXT.groupSwitch('Object write') })).toBeChecked()
    expect(screen.getByRole('switch', { name: AGENT_TEXT.groupSwitch('Claude Code built-ins') })).not.toBeChecked()
  })

  test('test turning the shell on asks first and shows the warning', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={['Bash']} onChange={onChange} />)
    await user.click(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' }))
    let dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(WARNING)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' })).not.toBeChecked()

    await user.click(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' }))
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' })).toBeChecked()
  })

  test('test turning the shell off does not ask', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={[]} onChange={onChange} />)
    await user.click(screen.getByRole('switch', { name: 'Shell (Bash, PowerShell)' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith(['Bash'])
  })

  test('test a group switch turns every row off', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={['Bash']} onChange={onChange} />)
    await user.click(screen.getByRole('switch', { name: AGENT_TEXT.groupSwitch('Object write') }))
    expect(onChange).toHaveBeenLastCalledWith(['Bash', 'mcp__object__create_object', 'mcp__object__write_body'])
    expect(screen.getByRole('switch', { name: 'create_object' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'write_body' })).not.toBeChecked()
    // And back on: every row of the group.
    await user.click(screen.getByRole('switch', { name: AGENT_TEXT.groupSwitch('Object write') }))
    expect(onChange).toHaveBeenLastCalledWith(['Bash'])
  })

  test('test a group switch that turns the shell on asks first', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={['Bash', 'Read']} onChange={onChange} />)
    await user.click(screen.getByRole('switch', { name: AGENT_TEXT.groupSwitch('Claude Code built-ins') }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(WARNING)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  test('test disabled switches do nothing', async () => {
    const onChange = vi.fn()
    render(<ToolSwitches groups={GROUPS} off={[]} onChange={onChange} disabled />)
    for (const s of screen.getAllByRole('switch')) expect(s).toBeDisabled()
  })
})

function server(partial: Partial<McpGroupStatus> = {}): McpGroupStatus {
  return { source: 'gateway', serverId: '01JSRV', name: 'fake', status: 'ok', error: null, fetchedAt: null, missingVars: [], ...partial }
}

function fakeGroup(partial: Partial<McpGroupStatus> = {}, rows = true): ToolGroup {
  return {
    id: 'mcp:fake',
    label: 'fake',
    tools: rows
      ? [
          { id: 'mcp__fake__add', label: 'add', on: true, warning: null },
          { id: 'mcp__fake__echo', label: 'echo', on: true, warning: null },
        ]
      : [],
    server: server(partial),
  }
}

describe('ToolSwitches: outside MCP servers', () => {
  test('test a server group lists its tools with switches and a group switch', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ToolSwitches groups={[fakeGroup()]} off={['mcp__fake__echo']} onChange={onChange} />)
    const group = screen.getByRole('region', { name: 'fake' })
    expect(within(group).getByRole('switch', { name: 'add' })).toBeChecked()
    expect(within(group).getByRole('switch', { name: 'echo' })).not.toBeChecked()
    const all = within(group).getByRole('switch', { name: AGENT_TEXT.groupSwitch('fake') })
    expect(all).not.toBeChecked()
    await user.click(all)
    expect(onChange).toHaveBeenLastCalledWith([])
    await user.click(within(group).getByRole('switch', { name: 'add' }))
    expect(onChange).toHaveBeenLastCalledWith(['mcp__fake__echo', 'mcp__fake__add'])
  })

  test("test a disabled server's group says Turned off in Settings > Integrations and its switches are disabled", () => {
    render(
      <ToolSwitches
        groups={[fakeGroup({ status: 'disabled' }), { ...fakeGroup({ source: 'folder', status: 'needsSecrets', missingVars: ['GH_TOKEN'] }), id: 'mcp:gh', label: "gh · this agent's folder" }]}
        off={[]}
        onChange={() => undefined}
      />,
    )
    const fake = screen.getByRole('region', { name: 'fake' })
    expect(within(fake).getByText(MCP_TEXT.turnedOffInSettings)).toBeInTheDocument()
    for (const s of within(fake).getAllByRole('switch')) expect(s).toBeDisabled()
    const gh = screen.getByRole('region', { name: "gh · this agent's folder" })
    expect(within(gh).getByText('Needs secrets: GH_TOKEN')).toBeInTheDocument()
    for (const s of within(gh).getAllByRole('switch')) expect(s).toBeDisabled()
  })

  test("test a failed listing shows Couldn't list tools with the error", () => {
    render(<ToolSwitches groups={[fakeGroup({ status: 'error', error: 'The server answered 500.' }, false)]} off={[]} onChange={() => undefined} />)
    const group = screen.getByRole('region', { name: 'fake' })
    expect(within(group).getByText("Couldn't list tools: The server answered 500.")).toBeInTheDocument()
    // A group with no rows has no group switch.
    expect(within(group).queryByRole('switch')).toBeNull()
  })

  test('test a listed server with no tools says No tools, and Listing tools… while loading', () => {
    const { rerender } = render(<ToolSwitches groups={[fakeGroup({}, false)]} off={[]} onChange={() => undefined} />)
    expect(screen.getByText(MCP_TEXT.noTools)).toBeInTheDocument()
    rerender(<ToolSwitches groups={[fakeGroup({ status: 'unknown' }, false)]} off={[]} onChange={() => undefined} serversLoading />)
    expect(screen.getByText(MCP_TEXT.listing)).toBeInTheDocument()
    expect(screen.queryByText(MCP_TEXT.noTools)).toBeNull()
    // Groups without a server never show a server line.
    rerender(<ToolSwitches groups={GROUPS} off={[]} onChange={() => undefined} serversLoading />)
    expect(screen.queryByText(MCP_TEXT.listing)).toBeNull()
  })
})
