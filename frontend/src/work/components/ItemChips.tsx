// M23 Task 8: a work item's chips: type, area, priority (Critical red, High amber, else muted) and
// the ticket id.
import type { JSX } from 'react'
import type { WorkBoardItem, WorkItem } from '@/api/types'
import { WORK_ICONS } from '../workIcons'
import { Chip, type ChipTone } from './Chip'

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const

/** The Desk priority for a ticket, else the item's own (T7's `effectivePriority`). */
function priorityOf(item: WorkBoardItem | WorkItem): string | null {
  if (item.ticket) return item.ticket.deskPriority
  const own = (item.priority ?? '').trim().toLowerCase()
  return PRIORITIES.find((p) => p.toLowerCase() === own) ?? null
}

const priorityTone = (p: string): ChipTone => (p === 'Critical' ? 'critical' : p === 'High' ? 'high' : 'muted')

export function ItemChips({ item }: { item: WorkBoardItem | WorkItem }): JSX.Element {
  const typeName = 'typeName' in item && typeof item.typeName === 'string' ? item.typeName : item.typeId
  const priority = priorityOf(item)
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5" data-work-chips="">
      <Chip tone="muted">{typeName}</Chip>
      {item.area && <Chip tone="muted">{item.area}</Chip>}
      {priority && <Chip tone={priorityTone(priority)}>{priority}</Chip>}
      {item.ticket?.id && (
        <Chip tone="muted" icon={WORK_ICONS.ticket}>
          {item.ticket.id}
        </Chip>
      )}
    </span>
  )
}
