import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { ToolGroup } from '@/api/types'
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
