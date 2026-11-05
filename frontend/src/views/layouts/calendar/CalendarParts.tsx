// M13 calendar layout: one object's chip (draggable when its date can be written), a day's cell
// (a drop target; a click on an empty spot creates), and the popover lists ("+N more", "No date").
import { memo, useState, type MouseEvent, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { Row, TypeDef } from '@/api/types'
import type { Day } from '@/calendar/dates'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { InlineToken } from '../../cards/InlineToken'
import { displayTitle } from '../../filter'
import { CALENDAR_TEXT } from './calendarModel'

export interface ChipProps {
  row: Row
  day: Day
  type?: TypeDef
  draggable: boolean
  selected: boolean
  /** The start time to show (a time value, on its first day). */
  time?: string
  onOpen(row: Row, e: MouseEvent): void
}

/**
 * dnd-kit's attributes without the screen-reader hints for a keyboard pick-up ("press space to pick
 * up"): the layout registers only a pointer sensor, so Space and Enter open the chip as a button.
 */
function pointerOnly(attrs: ReturnType<typeof useDraggable>['attributes']) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const { 'aria-describedby': _describedBy, 'aria-roledescription': _roleDescription, ...rest } = attrs
  return rest
}

/** One object on one day: its icon and title. The drag id names the day, as a range shows on several. */
export const Chip = memo(function Chip({ row, day, type, draggable, selected, time, onOpen }: ChipProps) {
  const d = useDraggable({ id: `${day}\n${row.summary.path}`, data: { path: row.summary.path, day }, disabled: !draggable })
  const icon = row.summary.icon ?? type?.icon ?? null
  return (
    <button
      ref={d.setNodeRef}
      type="button"
      {...(draggable ? pointerOnly(d.attributes) : {})}
      {...(draggable ? d.listeners : {})}
      data-testid="calendar-chip"
      data-chip
      data-path={row.summary.path}
      data-day={day}
      data-draggable={draggable ? 'true' : 'false'}
      data-selected={selected || undefined}
      title={displayTitle(row)}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(row, e)
      }}
      className={cn(
        'flex h-6 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-hover/60 px-1.5 text-left text-[13px] text-fg hover:bg-hover',
        draggable && 'cursor-grab',
        d.isDragging && 'opacity-40',
        selected && 'bg-[var(--block-selection-bg)]',
      )}
    >
      <span className="inline-flex w-4 shrink-0 justify-center">
        <IconOrEmoji icon={icon} fallback="ph-file-text" size={13} />
      </span>
      {time && <span className="shrink-0 text-[12px] text-fg-muted">{time}</span>}
      <span className="min-w-0 flex-1 truncate">{displayTitle(row)}</span>
    </button>
  )
})

/** The chip that follows the pointer while dragging. */
export function ChipGhost({ row, type }: { row: Row; type?: TypeDef }) {
  const icon = row.summary.icon ?? type?.icon ?? null
  return (
    <div className="flex h-6 max-w-56 min-w-0 items-center gap-1.5 rounded-md border border-line bg-raised px-1.5 text-[13px] text-fg shadow-md">
      <IconOrEmoji icon={icon} fallback="ph-file-text" size={13} />
      <span className="min-w-0 truncate">{displayTitle(row)}</span>
    </div>
  )
}

/** A list of rows in a popover ("+N more", "No date"): each opens its object. */
export function RowsPopover({
  label,
  heading,
  rows,
  typesById,
  multiType,
  onOpen,
  testId,
  className,
}: {
  label: ReactNode
  heading: string
  rows: Row[]
  typesById: Record<string, TypeDef>
  multiType: boolean
  onOpen(row: Row, e: MouseEvent): void
  testId: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testId} onClick={(e) => e.stopPropagation()} className={className}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto border-line bg-raised p-1" data-testid={`${testId}-list`}>
        <div className="px-2 py-1 text-[12px] text-fg-muted">{heading}</div>
        <ul role="list" className="flex flex-col">
          {rows.map((r) => (
            <li key={r.summary.path} data-path={r.summary.path}>
              <button
                type="button"
                onClick={(e) => {
                  setOpen(false)
                  onOpen(r, e)
                }}
                className="flex h-8 w-full min-w-0 items-center rounded-md px-2 text-left hover:bg-hover"
              >
                <InlineToken row={r} type={typesById[r.summary.type]} showType={multiType} />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export interface DayCellProps {
  day: Day
  /** Outside the shown month (muted). */
  outside: boolean
  today: boolean
  /** The week strip's taller column. */
  tall: boolean
  /** The header text (the month grid: the day's number; the week strip: "Mon 2"). */
  heading: string
  /** A click on an empty spot creates an object on this day. */
  onCreate?(day: Day): void
  children: ReactNode
}

/** One day: a drop target for chips; clicking its empty space creates an object dated that day. */
export function DayCell({ day, outside, today, tall, heading, onCreate, children }: DayCellProps) {
  const drop = useDroppable({ id: `day:${day}` })
  return (
    <div
      ref={drop.setNodeRef}
      role="gridcell"
      data-testid="calendar-day"
      data-day={day}
      data-outside={outside || undefined}
      aria-current={today ? 'date' : undefined}
      onClick={(e) => {
        if (!onCreate) return
        // Only the day's own space: chips, "+N more" and the "+" handle their own clicks.
        if (e.target instanceof Element && e.target.closest('button, [role="dialog"]')) return
        onCreate(day)
      }}
      className={cn(
        'group/day flex min-w-0 flex-col gap-0.5 border-r border-b border-line p-1',
        tall ? 'min-h-[24rem]' : 'min-h-[7rem]',
        outside && 'bg-hover/30',
        drop.isOver && 'bg-hover',
        onCreate && 'cursor-pointer',
      )}
    >
      <div className="flex h-6 items-center justify-between gap-1">
        <span
          className={cn(
            'flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-[13px]',
            today ? 'bg-today font-semibold text-white' : outside ? 'text-fg-muted' : 'text-fg',
          )}
        >
          {heading}
        </span>
        {onCreate && (
          <button
            type="button"
            aria-label={CALENDAR_TEXT.newOn(day)}
            title={CALENDAR_TEXT.newOn(day)}
            onClick={(e) => {
              e.stopPropagation()
              onCreate(day)
            }}
            className="flex size-5 items-center justify-center rounded text-fg-muted opacity-0 group-hover/day:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
          >
            <Icon name="ph-plus" size={12} />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}
