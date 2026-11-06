// M23 Task 14: the work item's Activity, newest first: the last 20, then "Show all" (ours).
import { useState, type JSX } from 'react'
import type { ActivityLine } from '@/api/types'
import { WORK_TEXT } from '../workText'

const ACTIVITY_SHOWN = 20

export function ActivityList({ lines }: { lines: ActivityLine[] }): JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? lines : lines.slice(0, ACTIVITY_SHOWN)
  return (
    <div className="flex flex-col gap-1">
      <ol aria-label={WORK_TEXT.activity} className="flex flex-col gap-0.5">
        {shown.map((l, i) => (
          <li key={`${l.raw}-${i}`} className="flex gap-2 text-[13px] leading-5">
            <span className="shrink-0 tabular-nums text-fg-muted">{l.at}</span>
            <span className="min-w-0 text-fg">{l.text}</span>
          </li>
        ))}
      </ol>
      {!all && lines.length > ACTIVITY_SHOWN && (
        <button type="button" onClick={() => setAll(true)} className="self-start text-[12px] text-fg-muted hover:text-fg">
          {WORK_TEXT.showAll}
        </button>
      )}
    </div>
  )
}
