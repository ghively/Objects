// M23 Task 9: the view switcher: every view in order with its icon, label and count (hidden at 0).
// Just one thing shows Now only.
import type { JSX } from 'react'
import type { WorkViewId } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import type { WorkDataState } from '../state/useWorkData'
import { useWorkUi } from '../state/useWorkUi'
import type { WorkViewDef } from '../views/registry'

/** The switcher's name (ours; not in `WORK_TEXT` yet, kept here until the review). */
const VIEWS_LABEL = 'Work views'

export function ViewSwitcher({
  views,
  selected,
  data,
  now,
}: {
  views: WorkViewDef[]
  selected: WorkViewId
  data: WorkDataState
  now: Date
}): JSX.Element {
  return (
    <nav aria-label={VIEWS_LABEL} className="flex flex-wrap items-center gap-1 border-b border-line pb-1">
      {views.map((v) => {
        const n = v.count(data, now)
        const on = v.id === selected
        return (
          <button
            key={v.id}
            type="button"
            data-work-view={v.id}
            aria-current={on ? 'page' : undefined}
            onClick={() => useWorkUi.getState().setView(v.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded px-2 text-[13px] hover:bg-hover',
              on ? 'text-[var(--work-you)]' : 'text-fg-muted',
            )}
          >
            <Icon name={v.icon} size={14} />
            <span>{v.label}</span>
            {n > 0 ? (
              <span data-count="" className="text-[11px] tabular-nums text-fg-muted">
                {n}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
