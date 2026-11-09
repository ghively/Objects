// The Tasks dashboard's view switcher (Gene's redesign): the Drive views on one calm row, and Plan,
// Manage and Review folded behind "More views" (a view from a folded group shows on the row while
// it is open). Each button: icon, label and count (hidden at 0). Just one thing shows Now only.
import { useState, type JSX } from 'react'
import type { WorkViewId } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import type { WorkDataState } from '../state/useWorkData'
import { useWorkUi } from '../state/useWorkUi'
import { groupOf, groupViews } from '../views/groups'
import type { WorkViewDef } from '../views/registry'

/** The switcher's name (ours). */
const VIEWS_LABEL = 'Work views'
export const MORE_VIEWS = 'More views'
export const FEWER_VIEWS = 'Fewer views'

function ViewButton({ v, on, data, now }: { v: WorkViewDef; on: boolean; data: WorkDataState; now: Date }): JSX.Element {
  const n = v.count(data, now)
  return (
    <button
      type="button"
      data-work-view={v.id}
      aria-current={on ? 'page' : undefined}
      onClick={() => useWorkUi.getState().setView(v.id)}
      className={cn(
        'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-medium',
        on ? 'bg-hover-2 text-fg' : 'text-fg-muted hover:bg-hover',
      )}
    >
      <Icon name={v.icon} size={14} />
      <span>{v.label}</span>
      {n > 0 ? (
        <span data-count="" className="text-[12px] tabular-nums text-fg-muted">
          {n}
        </span>
      ) : null}
    </button>
  )
}

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
  const [open, setOpen] = useState(false)
  const groups = groupViews(views)
  const drive = groups.find((g) => g.group.id === 'drive')?.views ?? []
  const folded = groups.filter((g) => g.group.id !== 'drive')
  const current = views.find((v) => v.id === selected)
  // The open view stays visible on the row while its group is folded away.
  const extra = !open && current && groupOf(current.id) !== 'drive' ? [current] : []
  return (
    <div className="border-b border-line pb-2">
      <nav aria-label={VIEWS_LABEL} className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {[...drive, ...extra].map((v) => (
            <ViewButton key={v.id} v={v} on={v.id === selected} data={data} now={now} />
          ))}
          {folded.length > 0 && (
            <button
              type="button"
              data-more-views=""
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="flex h-7 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[14px] font-medium text-fg-muted hover:bg-hover"
            >
              {open ? FEWER_VIEWS : MORE_VIEWS}
              <Icon name={open ? 'ph-caret-up' : 'ph-caret-down'} size={12} />
            </button>
          )}
        </div>
        {open && (
          <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
            {folded.map(({ group, views: vs }) => (
              <section key={group.id} aria-label={group.label} className="flex flex-col items-start gap-0.5">
                <h3 className="px-3 pb-1 text-[13px] font-semibold text-[var(--text-section)]">{group.label}</h3>
                {vs.map((v) => (
                  <ViewButton key={v.id} v={v} on={v.id === selected} data={data} now={now} />
                ))}
              </section>
            ))}
          </div>
        )}
      </nav>
    </div>
  )
}
