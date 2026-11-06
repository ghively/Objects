// M23 Task 14: the work item's Floor items, each with collect / un-tick (`api.workFloor`).
import { useState, type JSX } from 'react'
import type { FloorItemValue } from '@/api/types'
import { cn } from '@/lib/utils'
import { WORK_TEXT } from '../workText'

export function FloorList({
  items,
  onToggle,
}: {
  items: FloorItemValue[]
  /** Collect (or un-tick) the item; resolves when the write settled. */
  onToggle?: (item: FloorItemValue) => Promise<unknown>
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <ul aria-label={WORK_TEXT.floorItems} className="flex flex-col gap-0.5">
      {items.map((f) => {
        const label = [f.place, f.what].filter(Boolean).join(': ') || WORK_TEXT.anywhere
        return (
          <li key={f.id} className="flex items-center gap-2 text-[13px] leading-5">
            <input
              type="checkbox"
              aria-label={label}
              checked={!!f.collected}
              disabled={!onToggle || busy === f.id}
              onChange={() => {
                if (!onToggle) return
                setBusy(f.id)
                void onToggle(f).finally(() => setBusy(null))
              }}
            />
            <span className={cn('min-w-0', f.collected ? 'text-fg-muted line-through' : 'text-fg')}>{label}</span>
            {f.found && <span className="min-w-0 truncate text-[12px] text-fg-muted">{f.found}</span>}
          </li>
        )
      })}
    </ul>
  )
}
