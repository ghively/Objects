// M23 Task 8: a work item's chips are text and a dot in a tone, never a filled badge.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { TicketInfo } from '@/api/types'
import { workBoardItem, workItem } from '@/test/mockApi'
import { Chip } from './Chip'
import { ItemChips } from './ItemChips'
import { StatusIcon } from './StatusIcon'

const ticket = (over: Partial<TicketInfo> = {}): TicketInfo => ({
  id: 'INC0012345',
  system: 'ServiceNow',
  url: null,
  deskStatus: 'In Progress',
  deskPriority: 'Critical',
  requester: null,
  group: null,
  location: null,
  opened: null,
  updated: null,
  resolved: null,
  ...over,
})

function noFilledBackground(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const cls = el.getAttribute('class') ?? ''
    expect(cls, el.outerHTML).not.toMatch(/(^|\s)bg-/)
  }
}

describe('ItemChips', () => {
  test('test chips carry data-tone and no element has a filled background class', () => {
    const { container } = render(
      <ItemChips item={workBoardItem({ typeName: 'Ticket', area: 'Printers', priority: 'Low', ticket: ticket() })} />,
    )
    expect(screen.getByText('Ticket').closest('[data-tone]')).toHaveAttribute('data-tone', 'muted')
    expect(screen.getByText('Printers').closest('[data-tone]')).toHaveAttribute('data-tone', 'muted')
    // The Desk priority beats the item's own on a ticket.
    expect(screen.getByText('Critical').closest('[data-tone]')).toHaveAttribute('data-tone', 'critical')
    expect(screen.queryByText('Low')).toBeNull()
    expect(screen.getByText('INC0012345').closest('[data-tone]')).toHaveAttribute('data-tone', 'muted')
    noFilledBackground(container)
  })

  test('test high is amber, others muted, no priority no chip', () => {
    const { unmount } = render(<ItemChips item={workBoardItem({ priority: 'high' })} />)
    expect(screen.getByText('High').closest('[data-tone]')).toHaveAttribute('data-tone', 'high')
    expect(screen.getByText('Task')).toBeInTheDocument()
    unmount()
    const r = render(<ItemChips item={workBoardItem({ priority: 'Medium' })} />)
    expect(screen.getByText('Medium').closest('[data-tone]')).toHaveAttribute('data-tone', 'muted')
    r.unmount()
    render(<ItemChips item={workBoardItem({ priority: null, area: null })} />)
    expect(screen.queryByText('Medium')).toBeNull()
  })

  test('test a full work item shows its type id', () => {
    render(<ItemChips item={workItem({ typeId: 'task' })} />)
    expect(screen.getByText('task')).toBeInTheDocument()
  })

  test('test chip and status icon tones', () => {
    const { container } = render(
      <div>
        <Chip tone="agent">Agent</Chip>
        <StatusIcon state="approval" />
        <StatusIcon state="done" />
      </div>,
    )
    expect(screen.getByText('Agent').closest('[data-tone]')).toHaveAttribute('data-tone', 'agent')
    expect(container.querySelector('[data-state="approval"]')).toHaveAttribute('data-tone', 'approve')
    expect(container.querySelector('[data-state="done"]')).toHaveAttribute('data-tone', 'ok')
    noFilledBackground(container)
  })
})
